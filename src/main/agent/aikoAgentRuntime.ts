import { HumanMessage } from "@langchain/core/messages";
import type { BaseMessageLike } from "@langchain/core/messages";
import { ChatOpenAICompletions } from "@langchain/openai";
import { createAgent, tool } from "langchain";
import { z } from "zod";
import type { ChatPayload } from "../../shared/chatPayload";
import type { ChatResponse, PendingActionDto } from "../../shared/ipcTypes";
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
import type { AikoMemoryRuntime } from "./types";
import type { AikoTraceRecorder } from "./trace/aikoTrace";

type AgentInput = { messages: BaseMessageLike[] };
type LangChainAgent = ReturnType<typeof createAgent>;
type AgentStreamOptions = Parameters<LangChainAgent["stream"]>[1];

export const AIKO_CHAT_TEMPERATURE = 0.3;

export type AikoAgentInvoker = {
  invoke: (input: AgentInput) => Promise<unknown>;
  stream?: (input: AgentInput, options?: AgentStreamOptions) => Promise<AsyncIterable<unknown>> | AsyncIterable<unknown>;
};

export type AikoAgentFactory = (proposedActions: PendingActionDto[]) => AikoAgentInvoker;

export type AikoAgentRuntime = {
  respond: (payload: ChatPayload) => Promise<ChatResponse>;
  respondStream: (payload: ChatPayload, onDelta: (text: string) => void) => Promise<ChatResponse>;
};

export type MemoryCandidateExtractor = (transcript: string) => Promise<MemoryCandidate[]>;

export type AikoAgentRuntimeOptions = {
  config?: AppConfig;
  agent?: AikoAgentInvoker;
  agentFactory?: AikoAgentFactory;
  speechUnderstandingProvider?: SpeechUnderstandingProvider;
  memoryRuntime?: AikoMemoryRuntime;
  memoryCandidateExtractor?: MemoryCandidateExtractor;
  traceRecorder?: AikoTraceRecorder;
};

// 创建 Aiko 的运行时入口, 负责把消息, 工具, 记忆和语音结果串起来.
export function createAikoAgentRuntime(options: AikoAgentRuntimeOptions): AikoAgentRuntime {
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
      return respondWithAction(proposal.message, proposal.action);
    }

    if (proposal.kind === "blocked") {
      onDelta?.(proposal.message);
      trace.add("executor.blocked");
      trace.end({ mode: "blocked" });
      return { message: proposal.message };
    }

    const proposedActions: PendingActionDto[] = [];
    try {
      const agent = createRequestAgent(options, defaultAgentFactory, proposedActions);
      const input = {
        messages: [new HumanMessage({ content: context.userContent })]
      };
      const result = await runAgent(agent, input, onDelta);
      const assistantText = extractAssistantText(result);
      const action = proposedActions.at(-1);
      trace.add("agent.completed", {
        hasText: assistantText.length > 0,
        hasAction: Boolean(action)
      });

      // 工具调用只生成待确认动作, 真正执行只能交给本地执行器.
      if (action) {
        const message = "我可以帮你准备这个操作,执行前需要你确认.";
        if (!assistantText) onDelta?.(message);
        await rememberExchange(runtimeOptions, context.userTranscript, assistantText || message);
        trace.end({ mode: "tool_action" });
        return respondWithAction(message, action);
      }

      const message = assistantText || "我听到了,但这次没有生成有效回复.";
      if (!assistantText) onDelta?.(message);
      await rememberExchange(runtimeOptions, context.userTranscript, message);
      trace.end({ mode: "chat" });
      return { message };
    } catch {
      const message = "我现在连不上大模型,但本地提醒,打开应用这类简单操作还可以继续处理.";
      onDelta?.(message);
      trace.add("agent.failed");
      trace.end({ mode: "fallback" });
      return { message };
    }
  }

  return {
    respond: (payload) => respondInternal(payload),
    respondStream: (payload, onDelta) => respondInternal(payload, onDelta)
  };
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
