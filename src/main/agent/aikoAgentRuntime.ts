import { HumanMessage } from "@langchain/core/messages";
import { ChatOpenAICompletions } from "@langchain/openai";
import { createAgent, tool } from "langchain";
import { z } from "zod";
import type { ChatPayload } from "../../shared/chatPayload";
import type { ChatResponse, PendingActionDto } from "../../shared/ipcTypes";
import { AIKO_SYSTEM_PROMPT, MEMORY_EXTRACTION_PROMPT } from "../ai/prompts";
import type { AppConfig } from "../config/env";
import type { RecalledMemory } from "../memory/memoryRecall";
import type { MemoryCandidate, MemoryStatus } from "../memory/memoryTypes";
import { classifyMemoryCandidate, extractMemoryCandidates } from "../memory/silentMemoryWorker";
import type { SpeechUnderstandingProvider, SpeechUnderstandingResult } from "../voice/voiceTypes";

type AgentInput = { messages: Array<unknown> };

export type AikoAgentInvoker = {
  invoke: (input: AgentInput) => Promise<unknown>;
  stream?: (input: AgentInput, options?: unknown) => Promise<AsyncIterable<unknown>> | AsyncIterable<unknown>;
};

export type AikoAgentRuntime = {
  respond: (payload: ChatPayload) => Promise<ChatResponse>;
  respondStream: (payload: ChatPayload, onDelta: (text: string) => void) => Promise<ChatResponse>;
};

export type AikoMemoryRuntime = {
  recall: (query: string, limit?: number) => Promise<RecalledMemory[]> | RecalledMemory[];
  rememberCandidate: (candidate: MemoryCandidate, status: MemoryStatus) => Promise<unknown> | unknown;
};

export type MemoryCandidateExtractor = (transcript: string) => Promise<MemoryCandidate[]>;

export type AikoAgentRuntimeOptions = {
  config?: AppConfig;
  agent?: AikoAgentInvoker;
  speechUnderstandingProvider?: SpeechUnderstandingProvider;
  memoryRuntime?: AikoMemoryRuntime;
  memoryCandidateExtractor?: MemoryCandidateExtractor;
};

export function createAikoAgentRuntime(options: AikoAgentRuntimeOptions): AikoAgentRuntime {
  const proposedActions: PendingActionDto[] = [];
  const agent = options.agent ?? createDefaultAgent(options.config, proposedActions);
  const speechUnderstandingProvider =
    options.speechUnderstandingProvider ?? createPendingSpeechUnderstandingProvider();
  const memoryCandidateExtractor =
    options.memoryCandidateExtractor ?? (options.config ? createDefaultMemoryCandidateExtractor(options.config) : undefined);
  const runtimeOptions = {
    ...options,
    memoryCandidateExtractor
  };

  async function respondInternal(payload: ChatPayload, onDelta?: (text: string) => void): Promise<ChatResponse> {
    const speechResults = await understandSpeech(payload, speechUnderstandingProvider);
    const userTranscript = buildUserTranscript(payload, speechResults);
    const deterministicAction = detectDeterministicActionFromPayload(payload.text, speechResults);

    if (deterministicAction) {
      onDelta?.(deterministicAction.message);
      return respondWithAction(deterministicAction.message, deterministicAction.action);
    }

    proposedActions.length = 0;
    try {
      const recalledMemories = await recallForAgent(options.memoryRuntime, userTranscript);
      const input = {
        messages: [new HumanMessage({ content: buildUserContent(payload, speechResults, recalledMemories) })]
      };
      const result = await runAgent(agent, input, onDelta);
      const assistantText = extractAssistantText(result);
      const action = proposedActions.at(-1);

      if (action) {
        const message = "我可以帮你准备这个操作，执行前需要你确认。";
        if (!assistantText) onDelta?.(message);
        await rememberExchange(runtimeOptions, userTranscript, assistantText || message);
        return respondWithAction(message, action);
      }

      const message = assistantText || "我听到了，但这次没有生成有效回复。";
      if (!assistantText) onDelta?.(message);
      await rememberExchange(runtimeOptions, userTranscript, message);
      return { message };
    } catch {
      const message = "我现在连不上大模型，但本地提醒、打开应用这类简单操作还可以继续处理。";
      onDelta?.(message);
      return { message };
    }
  }

  return {
    respond: (payload) => respondInternal(payload),
    respondStream: (payload, onDelta) => respondInternal(payload, onDelta)
  };
}

function createDefaultAgent(config: AppConfig | undefined, proposedActions: PendingActionDto[]): AikoAgentInvoker {
  if (!config) {
    throw new Error("AikoAgentRuntime requires AppConfig when no test agent is injected");
  }

  const model = new ChatOpenAICompletions({
    model: config.glm.model,
    apiKey: config.glm.apiKey,
    temperature: 0.7,
    maxRetries: 1,
    configuration: {
      baseURL: config.glm.baseUrl
    }
  });

  return createAgent({
    model,
    systemPrompt: `${AIKO_SYSTEM_PROMPT}

你可以使用工具提出低风险本地操作，但工具只会生成待确认动作，不会真正执行 Windows 操作。涉及打开软件、打开网页、创建提醒、搜索网页时，优先调用对应工具。`,
    tools: createAikoTools(proposedActions)
  }) as unknown as AikoAgentInvoker;
}

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
      const response = await model.invoke([
        { role: "system", content: MEMORY_EXTRACTION_PROMPT },
        { role: "user", content: conversation }
      ]);
      return readContentText(response.content);
    });
}

function createAikoTools(proposedActions: PendingActionDto[]) {
  return [
    tool(
      ({ query, source }) => {
        proposedActions.push({
          title: `打开应用：${query}`,
          source: source || query,
          risk: "low",
          capability: "open_application",
          target: query
        });
        return "已生成打开应用的待确认动作。";
      },
      {
        name: "propose_open_application",
        description: "提出打开 Windows 应用的待确认动作。只生成动作，不执行。",
        schema: z.object({
          query: z.string().min(1).describe("应用名称或别名，例如 VS Code、Chrome"),
          source: z.string().optional().describe("用户原始请求")
        })
      }
    ),
    tool(
      ({ url, source }) => {
        proposedActions.push({
          title: `打开网页：${url}`,
          source: source || url,
          risk: "low",
          capability: "open_url",
          target: url
        });
        return "已生成打开网页的待确认动作。";
      },
      {
        name: "propose_open_url",
        description: "提出打开 URL 的待确认动作。只生成动作，不执行。",
        schema: z.object({
          url: z.string().url().describe("要打开的完整 URL"),
          source: z.string().optional().describe("用户原始请求")
        })
      }
    ),
    tool(
      ({ query, source }) => {
        const url = buildSearchUrl(query);
        proposedActions.push({
          title: `搜索网页：${query}`,
          source: source || query,
          risk: "low",
          capability: "open_url",
          target: url
        });
        return "已生成网页搜索的待确认动作。";
      },
      {
        name: "propose_web_search",
        description: "提出用默认浏览器搜索网页的待确认动作。只生成动作，不执行。",
        schema: z.object({
          query: z.string().min(1).describe("搜索关键词"),
          source: z.string().optional().describe("用户原始请求")
        })
      }
    ),
    tool(
      ({ amount, unit, title, source }) => {
        proposedActions.push({
          title: `创建提醒：${title}`,
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
        return "已生成创建提醒的待确认动作。";
      },
      {
        name: "propose_relative_reminder",
        description: "提出按分钟或小时创建相对提醒的待确认动作。只生成动作，不执行。",
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

type DetectedAction = {
  message: string;
  action: PendingActionDto;
};

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

function detectDeterministicAction(input: string): DetectedAction | null {
  const text = input.trim();

  const openUrlMatch = text.match(/^打开\s+(https?:\/\/\S+)$/i);
  if (openUrlMatch?.[1]) {
    const url = openUrlMatch[1].trim();
    return {
      message: "我可以帮你打开这个网页。",
      action: {
        title: `打开网页：${url}`,
        source: text,
        risk: "low",
        capability: "open_url",
        target: url
      }
    };
  }

  const searchMatch = text.match(/^(?:搜索|搜一下|查一下)\s+(.+)$/);
  if (searchMatch?.[1]) {
    const query = searchMatch[1].trim();
    return {
      message: `我可以帮你搜索：${query}`,
      action: {
        title: `搜索网页：${query}`,
        source: text,
        risk: "low",
        capability: "open_url",
        target: buildSearchUrl(query)
      }
    };
  }

  const openMatch = text.match(/^打开\s+(.+)$/);
  if (openMatch?.[1]) {
    const query = openMatch[1].trim();
    return {
      message: `我可以帮你打开 ${query}。`,
      action: {
        title: `打开应用：${query}`,
        source: text,
        risk: "low",
        capability: "open_application",
        target: query
      }
    };
  }

  const reminderMatch = text.match(/^(\d+)\s*(分钟|小时)后提醒我(.+)$/);
  if (reminderMatch?.[1] && reminderMatch?.[2] && reminderMatch?.[3]) {
    const amount = Number(reminderMatch[1]);
    const unit = reminderMatch[2] === "小时" ? "hours" : "minutes";
    const title = reminderMatch[3].trim();
    return {
      message: `我可以在 ${amount} ${reminderMatch[2]}后提醒你：${title}`,
      action: {
        title: `创建提醒：${title}`,
        source: text,
        risk: "low",
        capability: "create_reminder",
        target: title,
        params: {
          amount,
          unit,
          title
        }
      }
    };
  }

  return null;
}

function respondWithAction(message: string, action: PendingActionDto): ChatResponse {
  return {
    message,
    pendingAction: action
  };
}

async function understandSpeech(
  payload: ChatPayload,
  provider: SpeechUnderstandingProvider
): Promise<SpeechUnderstandingResult[]> {
  const audioAttachments = payload.attachments.filter((attachment) => attachment.kind === "audio");
  if (audioAttachments.length === 0) return [];

  try {
    return await provider.understand({ attachments: audioAttachments });
  } catch {
    return audioAttachments.map((attachment) => ({
      attachmentId: attachment.id,
      transcript: "",
      error: "语音理解暂时不可用。"
    }));
  }
}

function createPendingSpeechUnderstandingProvider(): SpeechUnderstandingProvider {
  return {
    async understand(input) {
      return input.attachments.map((attachment) => ({
        attachmentId: attachment.id,
        transcript: "",
        error: "语音理解 provider 尚未配置。"
      }));
    }
  };
}

function detectDeterministicActionFromPayload(
  text: string,
  speechResults: SpeechUnderstandingResult[]
): DetectedAction | null {
  const candidates = [text, ...speechResults.map((result) => result.transcript)].filter(
    (candidate) => candidate.trim().length > 0
  );

  for (const candidate of candidates) {
    const action = detectDeterministicAction(candidate);
    if (action) return action;
  }

  return null;
}

function buildUserContent(
  payload: ChatPayload,
  speechResults: SpeechUnderstandingResult[],
  recalledMemories: RecalledMemory[]
) {
  const imageAttachments = payload.attachments.filter((attachment) => attachment.kind === "image");
  const audioAttachments = payload.attachments.filter((attachment) => attachment.kind === "audio");

  const parts: Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }> = [];
  const transcriptText = speechResults
    .map((result) => result.transcript)
    .filter((transcript) => transcript.trim().length > 0)
    .join("\n");
  const text = payload.text || transcriptText || "请根据我上传的附件进行回应。";
  const speechContext = formatSpeechUnderstandingContext(audioAttachments.length, speechResults);
  const memoryContext = formatMemoryContext(recalledMemories);

  if (imageAttachments.length === 0) {
    return [text, memoryContext, speechContext].filter(Boolean).join("\n\n");
  }

  parts.push({ type: "text", text: [text, memoryContext, speechContext].filter(Boolean).join("\n\n") });
  for (const attachment of imageAttachments) {
    parts.push({ type: "image_url", image_url: { url: attachment.dataUrl } });
  }
  return parts;
}

function buildUserTranscript(payload: ChatPayload, speechResults: SpeechUnderstandingResult[]): string {
  return [payload.text, ...speechResults.map((result) => result.transcript)]
    .map((part) => part.trim())
    .filter(Boolean)
    .join("\n");
}

async function recallForAgent(memoryRuntime: AikoMemoryRuntime | undefined, query: string): Promise<RecalledMemory[]> {
  if (!memoryRuntime || query.trim().length === 0) return [];
  try {
    return await memoryRuntime.recall(query, 5);
  } catch {
    return [];
  }
}

async function rememberExchange(
  options: Pick<AikoAgentRuntimeOptions, "memoryCandidateExtractor" | "memoryRuntime">,
  userTranscript: string,
  assistantText: string
) {
  if (!options.memoryCandidateExtractor || !options.memoryRuntime || !userTranscript.trim()) return;
  const transcript = [`用户：${userTranscript}`, `Aiko：${assistantText}`].join("\n");
  try {
    const candidates = await options.memoryCandidateExtractor(transcript);
    for (const candidate of dedupeCandidates(candidates)) {
      await options.memoryRuntime.rememberCandidate(candidate, classifyMemoryCandidate(candidate));
    }
  } catch {
    return;
  }
}

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

function formatMemoryContext(memories: RecalledMemory[]): string {
  if (memories.length === 0) return "";
  const lines = memories.map((memory, index) => `${index + 1}. [${memory.type}] ${memory.content}`);
  return `长期记忆：\n${lines.join("\n")}`;
}

function formatSpeechUnderstandingContext(
  audioAttachmentCount: number,
  speechResults: SpeechUnderstandingResult[]
): string {
  if (audioAttachmentCount === 0) return "";
  if (speechResults.length === 0) return "语音理解：没有得到可用结果。";

  const lines = speechResults.map((result, index) => {
    const label = `语音 ${index + 1}`;
    if (result.transcript.trim().length > 0) {
      const confidence = typeof result.confidence === "number" ? `，置信度 ${result.confidence}` : "";
      const language = result.language ? `，语言 ${result.language}` : "";
      return `${label}：${result.transcript}${language}${confidence}`;
    }
    return `${label}：${result.error || "未识别到可用语音内容。"}`;
  });

  return `语音理解：\n${lines.join("\n")}`;
}

function buildSearchUrl(query: string): string {
  return `https://www.bing.com/search?q=${encodeURIComponent(query.trim())}`;
}

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
