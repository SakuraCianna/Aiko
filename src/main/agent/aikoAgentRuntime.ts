import { HumanMessage } from "@langchain/core/messages";
import type { BaseMessageLike } from "@langchain/core/messages";
import { ChatOpenAICompletions } from "@langchain/openai";
import { createAgent, tool } from "langchain";
import { z } from "zod";
import type { ChatPayload } from "../../shared/chatPayload";
import type { ChatResponse, PendingActionDto } from "../../shared/ipcTypes";
import {
  describePendingAction,
  describeEmptyAssistantReply,
  describeModelFallback,
  describeModelProposedAction
} from "../ai/aikoVoice";
import { buildAikoSystemPrompt, MEMORY_EXTRACTION_PROMPT } from "../ai/prompts";
import type { AppConfig } from "../config/env";
import type { MemoryCandidate, MemoryStatus } from "../memory/memoryTypes";
import { classifyMemoryCandidate, extractMemoryCandidates } from "../memory/silentMemoryWorker";
import type { SpeechUnderstandingProvider } from "../voice/voiceTypes";
import { createAikoExecutor } from "./executor/aikoExecutor";
import { buildSearchUrl, createAikoPlanner } from "./planner/aikoPlanner";
import { createAikoRetriever } from "./retriever/aikoRetriever";
import { createDefaultToolRegistry } from "./tools/toolRegistry";
import { createAikoTraceRecorder } from "./trace/aikoTrace";
import type { AgentUserContent, AikoMemoryRuntime } from "./types";
import type { AikoTraceRecorder } from "./trace/aikoTrace";

type AgentInput = { messages: BaseMessageLike[] };
type LangChainAgent = ReturnType<typeof createAgent>;
type AgentStreamOptions = Parameters<LangChainAgent["stream"]>[1];

export const AIKO_CHAT_TEMPERATURE = 0.3;
const LONG_RESPONSE_MARKDOWN_THRESHOLD = 1200;
const DESKTOP_MARKDOWN_TARGET = "Desktop/Aiko";

export type AikoAgentInvoker = {
  invoke: (input: AgentInput) => Promise<unknown>;
  stream?: (input: AgentInput, options?: AgentStreamOptions) => Promise<AsyncIterable<unknown>> | AsyncIterable<unknown>;
};

export type AikoAgentFactory = (proposedActions: PendingActionDto[]) => AikoAgentInvoker;

export type AikoAgentRuntime = {
  respond: (payload: ChatPayload) => Promise<ChatResponse>;
  respondStream: (payload: ChatPayload, onDelta: (text: string) => void) => Promise<ChatResponse>;
  listConversation: () => ConversationSnapshot;
  resetConversation: () => ConversationSnapshot;
};

export type MemoryCandidateExtractor = (transcript: string) => Promise<MemoryCandidate[]>;

export type ConversationMessage = {
  role: "user" | "assistant";
  content: string;
  createdAt: string;
};

export type ConversationSnapshot = {
  messages: ConversationMessage[];
  maxMessages: number;
  maxContextChars: number;
};

export type AikoAgentRuntimeOptions = {
  config?: AppConfig;
  agent?: AikoAgentInvoker;
  agentFactory?: AikoAgentFactory;
  speechUnderstandingProvider?: SpeechUnderstandingProvider;
  memoryRuntime?: AikoMemoryRuntime;
  memoryCandidateExtractor?: MemoryCandidateExtractor;
  traceRecorder?: AikoTraceRecorder;
  maxConversationMessages?: number;
  maxConversationContextChars?: number;
};

// 创建 Aiko 的运行时入口, 负责把消息, 工具, 记忆和语音结果串起来.
export function createAikoAgentRuntime(options: AikoAgentRuntimeOptions): AikoAgentRuntime {
  const maxConversationMessages = options.maxConversationMessages ?? 12;
  const maxConversationContextChars = options.maxConversationContextChars ?? 6000;
  const conversationMessages: ConversationMessage[] = [];
  const speechUnderstandingProvider =
    options.speechUnderstandingProvider;
  const toolRegistry = createDefaultToolRegistry();
  const retriever = createAikoRetriever({
    memoryRuntime: options.memoryRuntime,
    speechUnderstandingProvider,
    toolRegistry
  });
  const planner = createAikoPlanner();
  const executor = createAikoExecutor();
  const traceRecorder = options.traceRecorder ?? createAikoTraceRecorder();
  const defaultAgentFactory = options.config ? createDefaultAgentFactory(options.config, toolRegistry) : undefined;
  const memoryCandidateExtractor =
    options.memoryCandidateExtractor ?? (options.config ? createDefaultMemoryCandidateExtractor(options.config) : undefined);
  const runtimeOptions = {
    ...options,
    memoryCandidateExtractor
  };

  // 处理一次普通或流式聊天请求.
  async function respondInternal(payload: ChatPayload, onDelta?: (text: string) => void): Promise<ChatResponse> {
    if (isConversationResetRequest(payload)) {
      resetConversation();
      const message = "已开启新对话. 当前对话上下文已清空, 长期记忆仍然保留.";
      onDelta?.(message);
      return { message };
    }

    const trace = traceRecorder.start();
    const context = await retriever.retrieve(payload);
    trace.add("retriever.completed", {
      memoryCount: context.memories.length,
      attachmentCount: context.attachmentSummaries.length
    });

    const plan = await planner.plan({
      userText: context.userText,
      userTranscript: context.userTranscript,
      toolHints: context.toolHints
    });
    trace.add("planner.completed", {
      mode: plan.mode,
      stepCount: plan.steps.length
    });

    const proposal = await executor.prepare(plan);
    if (proposal.kind === "pending_action") {
      onDelta?.(proposal.message);
      trace.add("executor.prepared", {
        capability: proposal.action.capability,
        risk: proposal.action.risk
      });
      trace.end({ mode: "action" });
      rememberConversationTurn(context.userTranscript, proposal.message);
      return respondWithAction(proposal.message, proposal.action);
    }

    if (proposal.kind === "blocked") {
      onDelta?.(proposal.message);
      trace.add("executor.blocked");
      trace.end({ mode: "blocked" });
      rememberConversationTurn(context.userTranscript, proposal.message);
      return { message: proposal.message };
    }

    const proposedActions: PendingActionDto[] = [];
    try {
      const agent = createRequestAgent(options, defaultAgentFactory, proposedActions);
      const input = {
        messages: [new HumanMessage({ content: withConversationContext(context.userContent) })]
      };
      const prefersDesktopMarkdown = shouldPreferDesktopMarkdownResponse(context.userText, context.userTranscript);
      const result = await runAgent(agent, input, prefersDesktopMarkdown ? undefined : onDelta);
      const assistantText = extractAssistantText(result);
      const action = proposedActions.at(-1);
      trace.add("agent.completed", {
        hasText: assistantText.length > 0,
        hasAction: Boolean(action)
      });

      // 工具调用只生成待确认动作, 真正执行只能交给本地执行器.
      if (action) {
        const message = describeModelProposedAction(action);
        if (!assistantText) onDelta?.(message);
        await rememberExchange(runtimeOptions, context.userTranscript, assistantText || message);
        trace.end({ mode: "tool_action" });
        rememberConversationTurn(context.userTranscript, assistantText || message);
        return respondWithAction(message, action);
      }

      const markdownAction = createDesktopMarkdownAction(context.userTranscript || context.userText, assistantText, prefersDesktopMarkdown);
      if (markdownAction) {
        const message = describePendingAction(markdownAction);
        await rememberExchange(runtimeOptions, context.userTranscript, assistantText);
        trace.end({ mode: "markdown_action" });
        rememberConversationTurn(context.userTranscript, message);
        return respondWithAction(message, markdownAction);
      }

      const message = assistantText || describeEmptyAssistantReply();
      if (!assistantText) onDelta?.(message);
      await rememberExchange(runtimeOptions, context.userTranscript, message);
      trace.end({ mode: "chat" });
      rememberConversationTurn(context.userTranscript, message);
      return { message };
    } catch {
      const message = describeModelFallback();
      onDelta?.(message);
      trace.add("agent.failed");
      trace.end({ mode: "fallback" });
      rememberConversationTurn(context.userTranscript, message);
      return { message };
    }
  }

  return {
    respond: (payload) => respondInternal(payload),
    respondStream: (payload, onDelta) => respondInternal(payload, onDelta),
    listConversation,
    resetConversation
  };

  // 将当前短期上下文注入模型输入, 不影响长期记忆.
  function withConversationContext(userContent: AgentUserContent): AgentUserContent {
    const contextText = formatConversationContext(conversationMessages, maxConversationContextChars);
    if (!contextText) return userContent;

    if (typeof userContent === "string") {
      return [contextText, userContent].join("\n\n");
    }

    const [firstPart, ...otherParts] = userContent;
    if (firstPart?.type === "text") {
      return [
        {
          ...firstPart,
          text: [contextText, firstPart.text].filter(Boolean).join("\n\n")
        },
        ...otherParts
      ];
    }

    return [{ type: "text", text: contextText }, ...userContent];
  }

  // 把一轮用户输入和 Aiko 回复写入短期上下文.
  function rememberConversationTurn(userTranscript: string, assistantText: string) {
    const userContent = normalizeConversationContent(userTranscript);
    const assistantContent = normalizeConversationContent(assistantText);
    if (!userContent && !assistantContent) return;

    const createdAt = new Date().toISOString();
    if (userContent) {
      conversationMessages.push({ role: "user", content: userContent, createdAt });
    }
    if (assistantContent) {
      conversationMessages.push({ role: "assistant", content: assistantContent, createdAt });
    }
    trimConversationMessages(conversationMessages, maxConversationMessages);
  }

  // 返回当前短期上下文快照, 供管理面板展示.
  function listConversation(): ConversationSnapshot {
    return {
      messages: conversationMessages.map((message) => ({ ...message })),
      maxMessages: maxConversationMessages,
      maxContextChars: maxConversationContextChars
    };
  }

  // 清空当前短期上下文, 不触碰长期记忆, 权限和偏好.
  function resetConversation(): ConversationSnapshot {
    conversationMessages.length = 0;
    return listConversation();
  }
}

// 创建默认 LangChain Agent 工厂, 每次请求都注入独立的动作收集器.
function createDefaultAgentFactory(config: AppConfig, registry = createDefaultToolRegistry()): AikoAgentFactory {
  const model = new ChatOpenAICompletions({
    model: config.glm.model,
    apiKey: config.glm.apiKey,
    temperature: AIKO_CHAT_TEMPERATURE,
    maxRetries: 1,
    configuration: {
      baseURL: config.glm.baseUrl
    }
  });

  return (proposedActions) =>
    createAgent({
      model,
      systemPrompt: buildAikoSystemPrompt(),
      tools: createAikoTools(proposedActions, registry)
    });
}

// 判断用户是否明确要求开启新对话或清空当前上下文.
export function isConversationResetRequest(payload: ChatPayload): boolean {
  if (payload.attachments.length > 0) return false;
  const text = normalizeConversationResetText(payload.text);
  if (!text || /(?:总结|回顾|整理|复盘|保存|导出).{0,8}(?:刚才|前面|之前|当前)?(?:聊天|对话|上下文)/.test(text)) {
    return false;
  }

  return (
    /(?:清空|删除|重置|忘掉|忘记).{0,8}(?:当前|现在|本轮|刚才|之前|前面)?(?:对话|上下文|聊天记录|聊天)/.test(text)
    || /(?:开启|开始|新建|开)(?:一个|一段|个|段)?新的?(?:对话|聊天|话题)/.test(text)
    || /^(?:我们)?(?:重新开始|从头开始|重开)(?:聊|聊天|对话)?$/.test(text)
    || /(?:重新开始|从头开始|另起|重开).{0,8}(?:聊|聊天|对话|话题)/.test(text)
    || /(?:换个|换一个|换段|换一段)新的?(?:话题|聊天|对话)/.test(text)
  );
}

// 归一化新会话意图文本, 去掉语气词和标点以提高自然表达命中率.
function normalizeConversationResetText(input: string): string {
  return input
    .trim()
    .replace(/[。.!！?？，,、；;：:\s]+/g, "")
    .replace(/^(?:请|麻烦|拜托)?(?:你)?(?:帮我)?/, "")
    .replace(/(?:吧|呀|啦|呢|一下|可以吗|行吗)$/g, "");
}

// 格式化短期上下文, 让模型知道它不是长期记忆.
function formatConversationContext(messages: ConversationMessage[], maxChars: number): string {
  if (messages.length === 0) return "";

  const selected: string[] = [];
  let usedChars = 0;
  for (const message of [...messages].reverse()) {
    const roleLabel = message.role === "user" ? "用户" : "Aiko";
    const line = `${roleLabel}:${message.content}`;
    if (usedChars + line.length > maxChars && selected.length > 0) break;
    selected.push(line);
    usedChars += line.length;
    if (usedChars >= maxChars) break;
  }

  return [
    "当前对话上下文(短期,可清空;只用于保持本轮连续性;如果与当前输入冲突,以当前输入优先):",
    ...selected.reverse()
  ].join("\n");
}

// 归一化短期上下文消息, 避免单条长文塞爆后续提示词.
function normalizeConversationContent(content: string): string {
  const normalized = content.trim().replace(/\s+/g, " ");
  if (normalized.length <= 2000) return normalized;
  return `${normalized.slice(0, 2000)}...`;
}

// 按消息数量裁剪短期上下文, 保留最近的连续消息.
function trimConversationMessages(messages: ConversationMessage[], maxMessages: number) {
  if (messages.length <= maxMessages) return;
  messages.splice(0, messages.length - maxMessages);
}

// 为当前请求创建 Agent, 避免跨请求共享工具动作状态.
function createRequestAgent(
  options: AikoAgentRuntimeOptions,
  defaultAgentFactory: AikoAgentFactory | undefined,
  proposedActions: PendingActionDto[]
): AikoAgentInvoker {
  if (options.agent) return options.agent;
  const factory = options.agentFactory ?? defaultAgentFactory;
  if (!factory) {
    throw new Error("AikoAgentRuntime requires AppConfig when no test agent is injected");
  }
  return factory(proposedActions);
}

// 创建默认记忆候选提取器, 使用低温度模型输出结构化记忆.
function createDefaultMemoryCandidateExtractor(config: AppConfig): MemoryCandidateExtractor {
  const model = new ChatOpenAICompletions({
    model: config.glm.model,
    apiKey: config.glm.apiKey,
    temperature: 0,
    maxRetries: 1,
    configuration: {
      baseURL: config.glm.baseUrl
    }
  });

  return (transcript) =>
    extractMemoryCandidates(transcript, async (conversation) => {
      // 记忆提取和聊天人格隔离, 避免角色语气污染长期事实.
      const response = await model.invoke([
        { role: "system", content: MEMORY_EXTRACTION_PROMPT },
        { role: "user", content: conversation }
      ]);
      return readContentText(response.content);
    });
}

// 创建 Aiko 可调用的工具列表, 工具只负责生成待确认动作.
function createAikoTools(proposedActions: PendingActionDto[], registry = createDefaultToolRegistry()) {
  const openApplication = registry.get("open_application");
  const openUrl = registry.get("open_url");
  const webSearch = registry.get("web_search");
  const createReminder = registry.get("create_reminder");
  const cancelReminder = registry.get("cancel_reminder");
  const writeDesktopMarkdown = registry.get("write_desktop_markdown");

  return [
    // 生成打开应用的待确认动作.
    tool(
      ({ query, source }) => {
        proposedActions.push({
          title: `打开应用:${query}`,
          source: source || query,
          risk: "low",
          capability: "open_application",
          target: query
        });
        return "已生成打开应用的待确认动作.";
      },
      {
        name: "propose_open_application",
        description: openApplication?.description ?? "提出打开 Windows 应用的待确认动作.只生成动作,不执行.",
        schema: z.object({
          query: z.string().min(1).describe("应用名称或别名,例如 VS Code,Chrome"),
          source: z.string().optional().describe("用户原始请求")
        })
      }
    ),
    // 生成打开网页的待确认动作.
    tool(
      ({ url, source }) => {
        proposedActions.push({
          title: `打开网页:${url}`,
          source: source || url,
          risk: "low",
          capability: "open_url",
          target: url
        });
        return "已生成打开网页的待确认动作.";
      },
      {
        name: "propose_open_url",
        description: openUrl?.description ?? "提出打开 URL 的待确认动作.只生成动作,不执行.",
        schema: z.object({
          url: z.string().url().describe("要打开的完整 URL"),
          source: z.string().optional().describe("用户原始请求")
        })
      }
    ),
    // 生成网页搜索的待确认动作.
    tool(
      ({ query, source }) => {
        const url = buildSearchUrl(query);
        proposedActions.push({
          title: `搜索网页:${query}`,
          source: source || query,
          risk: "low",
          capability: "open_url",
          target: url
        });
        return "已生成网页搜索的待确认动作.";
      },
      {
        name: "propose_web_search",
        description: webSearch?.description ?? "提出用默认浏览器搜索网页的待确认动作.只生成动作,不执行.",
        schema: z.object({
          query: z.string().min(1).describe("搜索关键词"),
          source: z.string().optional().describe("用户原始请求")
        })
      }
    ),
    // 生成相对时间提醒的待确认动作.
    tool(
      ({ amount, unit, title, source }) => {
        proposedActions.push({
          title: `创建提醒:${title}`,
          source: source || title,
          risk: "low",
          capability: "create_reminder",
          target: title,
          params: {
            amount,
            unit,
            title
          }
        });
        return "已生成创建提醒的待确认动作.";
      },
      {
        name: "propose_relative_reminder",
        description: createReminder?.description ?? "提出按分钟或小时创建相对提醒的待确认动作.只生成动作,不执行.",
        schema: z.object({
          amount: z.number().int().positive().describe("提醒延迟数量"),
          unit: z.enum(["minutes", "hours"]).describe("延迟单位"),
          title: z.string().min(1).describe("提醒标题"),
          source: z.string().optional().describe("用户原始请求")
        })
      }
    ),
    // 生成取消最近提醒的待确认动作.
    tool(
      ({ target, source }) => {
        proposedActions.push({
          title: "取消最近提醒",
          source: source || "取消最近提醒",
          risk: "low",
          capability: "cancel_reminder",
          target,
          params: {
            target
          }
        });
        return "已生成取消最近提醒的待确认动作.";
      },
      {
        name: "propose_cancel_latest_reminder",
        description: cancelReminder?.description ?? "提出取消最近一条待触发提醒的待确认动作.只生成动作,不执行.",
        schema: z.object({
          target: z.literal("latest").describe("只能取消最近一条仍然激活的提醒"),
          source: z.string().optional().describe("用户原始请求")
        })
      }
    ),
    // 生成写入桌面 Markdown 的待确认动作.
    tool(
      ({ title, content, source }) => {
        proposedActions.push({
          title: "写入 Aiko回答.md",
          source: source || title,
          risk: "medium",
          capability: "write_desktop_markdown",
          target: DESKTOP_MARKDOWN_TARGET,
          params: {
            title: title || "Aiko回答",
            content
          }
        });
        return "已生成写入桌面 Markdown 的待确认动作.";
      },
      {
        name: "propose_desktop_markdown",
        description:
          writeDesktopMarkdown?.description ?? "提出把长篇回复写入桌面 Aiko 文件夹 Markdown 文件的待确认动作.只生成动作,不执行.",
        schema: z.object({
          title: z.string().min(1).max(120).describe("Markdown 文件标题,默认使用 Aiko回答"),
          content: z.string().min(1).max(200000).describe("要写入 Markdown 的完整正文"),
          source: z.string().optional().describe("用户原始请求")
        })
      }
    )
  ];
}

// 调用 Agent, 如果支持 stream 就把增量文本转发给渲染层.
async function runAgent(
  agent: AikoAgentInvoker,
  input: AgentInput,
  onDelta?: (text: string) => void
): Promise<unknown> {
  if (!onDelta || !agent.stream) return agent.invoke(input);

  let latestText = "";
  let latestChunk: unknown = null;

  const stream = await agent.stream(input, { streamMode: "values" });
  for await (const chunk of stream) {
    latestChunk = chunk;
    const text = extractAssistantText(chunk);
    if (!text || text === latestText) continue;

    if (text.startsWith(latestText)) {
      const delta = text.slice(latestText.length);
      if (delta) onDelta(delta);
    } else {
      onDelta(text);
    }
    latestText = text;
  }

  return latestChunk ?? agent.invoke(input);
}

// 把回复文本和待确认动作合并为 IPC 可返回的结构.
function respondWithAction(message: string, action: PendingActionDto): ChatResponse {
  return {
    message,
    pendingAction: action
  };
}

// 判断这次请求是否更适合落成 Markdown 文件, 避免长文塞进桌宠消息区.
export function shouldPreferDesktopMarkdownResponse(userText: string, userTranscript = ""): boolean {
  const text = `${userText}\n${userTranscript}`.trim();
  if (!text) return false;

  const asksForDocument = /(?:生成|写|制定|整理|输出|起草|设计|做).{0,12}(?:一份|详细|具体|完整|系统|规划|计划|方案|文档|报告|清单|教程|大纲|路线图|总结)/.test(text);
  const documentNoun = /(?:规划|计划|方案|文档|报告|清单|教程|大纲|路线图|总结)/.test(text);
  const longSignal = /(?:一份|详细|具体|完整|长文|长一点|系统性|可执行|时间表|步骤)/.test(text);
  return asksForDocument || (documentNoun && longSignal);
}

// 根据模型正文生成写入桌面 Markdown 的待确认动作.
function createDesktopMarkdownAction(source: string, assistantText: string, preferredByRequest: boolean): PendingActionDto | null {
  const content = assistantText.trim();
  if (!content) return null;
  if (!preferredByRequest && content.length < LONG_RESPONSE_MARKDOWN_THRESHOLD) return null;

  return {
    title: "写入 Aiko回答.md",
    source: source.trim().slice(0, 1000) || "长篇回复",
    risk: "medium",
    capability: "write_desktop_markdown",
    target: DESKTOP_MARKDOWN_TARGET,
    params: {
      title: "Aiko回答",
      content
    }
  };
}

// 在一次对话后静默抽取并保存可能有价值的长期记忆.
async function rememberExchange(
  options: Pick<AikoAgentRuntimeOptions, "memoryCandidateExtractor" | "memoryRuntime">,
  userTranscript: string,
  assistantText: string
) {
  if (!options.memoryCandidateExtractor || !options.memoryRuntime || !userTranscript.trim()) return;
  const transcript = [`用户:${userTranscript}`, `Aiko:${assistantText}`].join("\n");
  try {
    const candidates = await options.memoryCandidateExtractor(transcript);
    for (const candidate of dedupeCandidates(candidates)) {
      await options.memoryRuntime.rememberCandidate(candidate, classifyMemoryCandidate(candidate));
    }
  } catch {
    return;
  }
}

// 对同类型同内容的记忆候选去重, 保留置信度最高的一条.
function dedupeCandidates(candidates: MemoryCandidate[]): MemoryCandidate[] {
  const byKey = new Map<string, MemoryCandidate>();
  for (const candidate of candidates) {
    const key = `${candidate.type}:${candidate.content.trim().toLowerCase()}`;
    const existing = byKey.get(key);
    if (!existing || candidate.confidence > existing.confidence) {
      byKey.set(key, {
        ...candidate,
        content: candidate.content.trim()
      });
    }
  }
  return [...byKey.values()];
}

// 从 LangChain 返回结构中提取最后一条 assistant 文本.
export function extractAssistantText(result: unknown): string {
  const messages = Array.isArray((result as { messages?: unknown[] }).messages)
    ? (result as { messages: unknown[] }).messages
    : [];

  for (const message of [...messages].reverse()) {
    const role = readRole(message);
    if (role && role !== "assistant" && role !== "ai") continue;

    const text = readContentText((message as { content?: unknown }).content);
    if (text) return text;
  }

  return "";
}

// 读取不同消息对象里的角色字段.
function readRole(message: unknown): string | null {
  if (!message || typeof message !== "object") return null;
  const role = (message as { role?: unknown; type?: unknown }).role ?? (message as { type?: unknown }).type;
  if (typeof role === "string") return role;

  const getType = (message as { _getType?: unknown })._getType;
  if (typeof getType === "function") {
    const type = getType.call(message);
    return typeof type === "string" ? type : null;
  }

  return null;
}

// 把字符串或多段文本内容归一成普通文本.
function readContentText(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";

  return content
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      const text = (part as { text?: unknown }).text;
      return typeof text === "string" ? text : "";
    })
    .join("")
    .trim();
}
