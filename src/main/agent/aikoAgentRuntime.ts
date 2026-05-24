import { randomUUID } from "node:crypto";
import { HumanMessage } from "@langchain/core/messages";
import type { BaseMessageLike } from "@langchain/core/messages";
import type { BaseCheckpointSaver } from "@langchain/langgraph";
import { ChatOpenAICompletions } from "@langchain/openai";
import { createAgent, tool } from "langchain";
import { z } from "zod";
import type { ChatPayload } from "../../shared/chatPayload";
import type { AikoAgentDebugSnapshotDto, ChatResponse, PendingActionDto } from "../../shared/ipcTypes";
import {
  describePendingAction,
  describeEmptyAssistantReply,
  describeModelFallback,
  describeModelProposedAction
} from "../ai/aikoVoice";
import {
  isAutoExecutableDesktopMarkdownAction,
  markAutoExecutableDesktopMarkdownAction
} from "../actions/localActionTrust";
import { buildAikoSystemPrompt, MEMORY_EXTRACTION_PROMPT } from "../ai/prompts";
import type { AppConfig } from "../config/env";
import type { MemoryCandidate } from "../memory/memoryTypes";
import { extractMemoryCandidates } from "../memory/silentMemoryWorker";
import type { SpeechUnderstandingProvider } from "../voice/voiceTypes";
import { createAikoExecutor } from "./executor/aikoExecutor";
import { createAikoCommitmentService } from "./commitments/commitmentService";
import type { AikoCommitment, AikoCommitmentService } from "./commitments/commitmentService";
import {
  createAikoActionApprovalWorkflow,
  createAikoAgentWorkflow,
  createAikoModelResponseWorkflow,
  isAikoAgentWorkflowInterrupted,
  type AikoActionApprovalWorkflow,
  type AikoAgentWorkflow,
  type AikoAgentWorkflowApprovalMode,
  type AikoPendingActionReviewDecision,
  type AikoPendingActionReviewPayload
} from "./graph/aikoAgentWorkflow";
import { createCurrentKnowledgeProvider } from "./knowledge/currentKnowledgeProvider";
import type { CurrentKnowledgeProvider } from "./knowledge/currentKnowledgeProvider";
import { createTavilyWebSearchProvider } from "./mcp/tavilyMcpProvider";
import { createDefaultCapabilityPolicy } from "./policy/capabilityPolicy";
import type { AikoCapabilityPolicy } from "./policy/capabilityPolicy";
import { buildSearchUrl, createAikoPlanner } from "./planner/aikoPlanner";
import { createAikoRetriever } from "./retriever/aikoRetriever";
import { createWebRetriever } from "./retriever/webRetriever";
import { createAikoActionJournal } from "./runtime/actionJournal";
import type { AikoActionJournal, AikoActionJournalEntry } from "./runtime/actionJournal";
import { createAikoRunLifecycle } from "./runtime/runLifecycle";
import type { AikoRunLifecycle, AikoRunRecord } from "./runtime/runLifecycle";
import { createAikoRuntimeHooks } from "./runtime/runtimeHooks";
import type { AikoRuntimeHooks } from "./runtime/runtimeHooks";
import { createAikoMemoryAgent } from "./subagents/memoryAgent";
import type { AikoMemoryAgent, MemoryCandidateExtractor } from "./subagents/memoryAgent";
import { createDefaultToolRegistry } from "./tools/toolRegistry";
import { createAikoTraceRecorder } from "./trace/aikoTrace";
import type { AgentUserContent, AikoMemoryRuntime, RetrievedContext } from "./types";
import type { AikoTraceRecorder } from "./trace/aikoTrace";
import type { WebRetriever } from "./retriever/webRetriever";
import { createAikoWorkerRegistry } from "./workers/workerRegistry";
import type { AikoWorkerRegistry, AikoWorkerSummary } from "./workers/workerRegistry";

type AgentInput = { messages: BaseMessageLike[] };
type LangChainAgent = ReturnType<typeof createAgent>;
type AgentInvokeOptions = Parameters<LangChainAgent["invoke"]>[1];
type AgentStreamOptions = Parameters<LangChainAgent["stream"]>[1];
type AssistantTextExtractionOptions = {
  streaming?: boolean;
};
type AikoModelResponseMode = "tool_action" | "markdown_action" | "chat";
type AikoModelResponseOutcome = {
  response: ChatResponse;
  mode: AikoModelResponseMode;
  memoryText: string;
  conversationText: string;
  traceData: {
    hasText: boolean;
    hasAction: boolean;
  };
};
type AikoModelPostprocessInput = {
  context: RetrievedContext;
  proposedActions: PendingActionDto[];
  prefersDesktopMarkdown: boolean;
  emitDelta: (text: string) => void;
  signal?: AbortSignal;
  runId?: string;
};

export const AIKO_CHAT_TEMPERATURE = 0.3;
const LONG_RESPONSE_MARKDOWN_THRESHOLD = 1200;
const DESKTOP_MARKDOWN_TARGET = "Desktop/Aiko";
const STREAM_CANCELLED_MESSAGE = "已中止. 我先停下.";

export type AikoAgentInvoker = {
  invoke: (input: AgentInput, options?: AgentInvokeOptions) => Promise<unknown>;
  stream?: (input: AgentInput, options?: AgentStreamOptions) => Promise<AsyncIterable<unknown>> | AsyncIterable<unknown>;
};

export type AikoAgentFactory = (proposedActions: PendingActionDto[]) => AikoAgentInvoker;

export type AikoAgentRuntime = {
  respond: (payload: ChatPayload) => Promise<ChatResponse>;
  respondStream: (
    payload: ChatPayload,
    onDelta: (text: string) => void,
    options?: AikoAgentRequestOptions
  ) => Promise<ChatResponse>;
  resumePendingActionApproval: (
    action: PendingActionDto,
    decision: AikoPendingActionReviewDecision
  ) => Promise<{ ok: boolean; message: string }>;
  discardPendingActionApproval: (action: PendingActionDto) => void;
  listConversation: () => ConversationSnapshot;
  resetConversation: () => ConversationSnapshot;
  listRuns: () => AikoRunRecord[];
  listActionJournal: () => AikoActionJournalEntry[];
  listCommitments: () => AikoCommitment[];
  listWorkers: () => AikoWorkerSummary[];
  listAgentDebugSnapshot: () => AikoAgentDebugSnapshotDto;
};

export type AikoAgentRequestOptions = {
  signal?: AbortSignal;
};

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
  memoryAgent?: AikoMemoryAgent;
  memoryRuntime?: AikoMemoryRuntime;
  memoryCandidateExtractor?: MemoryCandidateExtractor;
  webRetriever?: WebRetriever;
  traceRecorder?: AikoTraceRecorder;
  runLifecycle?: AikoRunLifecycle;
  actionJournal?: AikoActionJournal;
  commitmentService?: AikoCommitmentService;
  hooks?: AikoRuntimeHooks;
  workerRegistry?: AikoWorkerRegistry;
  capabilityPolicy?: AikoCapabilityPolicy;
  currentKnowledgeProvider?: CurrentKnowledgeProvider;
  approvalMode?: AikoAgentWorkflowApprovalMode;
  approvalThreadIdFactory?: () => string;
  workflowCheckpointer?: BaseCheckpointSaver;
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
  const webRetriever = options.webRetriever ?? createDefaultWebRetriever(options.config);
  const currentKnowledgeProvider = options.currentKnowledgeProvider ?? createCurrentKnowledgeProvider();
  const defaultAgentFactory = options.config ? createDefaultAgentFactory(options.config, toolRegistry) : undefined;
  const memoryCandidateExtractor =
    options.memoryCandidateExtractor ?? (options.config ? createDefaultMemoryCandidateExtractor(options.config) : undefined);
  const memoryAgent =
    options.memoryAgent ??
    createAikoMemoryAgent({
      memoryRuntime: options.memoryRuntime,
      memoryCandidateExtractor
    });
  const retriever = createAikoRetriever({
    memoryAgent,
    speechUnderstandingProvider,
    toolRegistry,
    webRetriever,
    currentKnowledgeProvider
  });
  const planner = createAikoPlanner();
  const capabilityPolicy = options.capabilityPolicy ?? createDefaultCapabilityPolicy();
  const executor = createAikoExecutor(capabilityPolicy);
  const traceRecorder = options.traceRecorder ?? createAikoTraceRecorder();
  const runLifecycle = options.runLifecycle ?? createAikoRunLifecycle();
  const actionJournal = options.actionJournal ?? createAikoActionJournal();
  const commitmentService = options.commitmentService ?? createAikoCommitmentService();
  const hooks = options.hooks ?? createAikoRuntimeHooks();
  const workerRegistry = options.workerRegistry ?? createAikoWorkerRegistry();
  registerDefaultWorkers(workerRegistry);
  const approvalMode = options.approvalMode ?? "interrupt";
  const approvalThreadIdFactory = options.approvalThreadIdFactory ?? (() => `aiko-approval-${randomUUID()}`);
  const approvalSessions = new Map<string, AikoAgentWorkflow | AikoActionApprovalWorkflow>();
  const approvalThreadRuns = new Map<string, string>();
  // 处理一次普通或流式聊天请求.
  async function respondInternal(
    payload: ChatPayload,
    onDelta?: (text: string) => void,
    requestOptions: AikoAgentRequestOptions = {},
    runId?: string
  ): Promise<ChatResponse> {
    const signal = requestOptions.signal;
    if (isAbortSignalAborted(signal)) return { message: STREAM_CANCELLED_MESSAGE };
    const emitDelta = (text: string) => {
      if (!isAbortSignalAborted(signal)) onDelta?.(text);
    };

    if (isConversationResetRequest(payload)) {
      resetConversation();
      const message = "已开启新对话. 当前对话上下文已清空, 长期记忆仍然保留.";
      emitDelta(message);
      return { message };
    }

    if (isSimpleGreetingRequest(payload)) {
      const message = createSimpleGreetingReply();
      emitDelta(message);
      rememberConversationTurn(payload.text, message);
      return { message };
    }

    const trace = traceRecorder.start();
    const approvalThreadId = approvalMode === "interrupt" ? approvalThreadIdFactory() : undefined;
    const workflow = createAikoAgentWorkflow({
      approvalMode,
      checkpointer: options.workflowCheckpointer,
      async retrieve(input) {
        const context = await retriever.retrieve(input, { signal });
        throwIfAborted(signal);
        trace.add("retriever.completed", {
          memoryCount: context.memories.length,
          attachmentCount: context.attachmentSummaries.length,
          currentKnowledgeKind: context.currentKnowledge?.kind ?? null
        });
        return context;
      },
      async plan(context) {
        const plan = await planner.plan({
          userText: context.userText,
          userTranscript: context.userTranscript,
          toolHints: context.toolHints
        });
        throwIfAborted(signal);
        trace.add("planner.completed", {
          mode: plan.mode,
          stepCount: plan.steps.length
        });
        return plan;
      },
      async prepare(plan) {
        const proposal = await executor.prepare(plan);
        throwIfAborted(signal);
        return proposal;
      }
    });
    const workflowOutput = await workflow.invoke(payload, { threadId: approvalThreadId });
    if (isAikoAgentWorkflowInterrupted(workflowOutput)) {
      if (!approvalThreadId) throw new Error("Aiko workflow interrupted without an approval thread");
      const reviewPayload = readWorkflowInterruptPayload(workflowOutput);
      if (!reviewPayload) throw new Error("Aiko workflow interrupted without a pending action payload");
      approvalSessions.set(approvalThreadId, workflow);
      const action = await trackPendingAction(attachWorkflowApproval(reviewPayload.action, approvalThreadId, "agent"), runId, "workflow");
      emitDelta(reviewPayload.message);
      trace.add("executor.prepared", {
        capability: action.capability,
        risk: action.risk
      });
      trace.end({ mode: "action" });
      rememberConversationTurn(payload.text, reviewPayload.message);
      return respondWithAction(reviewPayload.message, action);
    }
    const { context, proposal } = workflowOutput;
    throwIfAborted(signal);
    if (proposal.kind === "pending_actions") {
      const batchAction = createBatchAction(proposal.message, context.userTranscript, proposal.actions);
      const approvedAction = await trackPendingAction(
        await preparePendingActionApproval(proposal.message, batchAction),
        runId,
        "executor.batch"
      );
      emitDelta(proposal.message);
      trace.add("executor.prepared_batch", {
        actionCount: proposal.actions.length,
        risk: batchAction.risk
      });
      trace.end({ mode: "action" });
      rememberConversationTurn(context.userTranscript, proposal.message);
      return respondWithAction(proposal.message, approvedAction);
    }

    if (proposal.kind === "pending_action") {
      const action = await trackPendingAction(proposal.action, runId, "executor");
      emitDelta(proposal.message);
      trace.add("executor.prepared", {
        capability: action.capability,
        risk: action.risk
      });
      trace.end({ mode: "action" });
      rememberConversationTurn(context.userTranscript, proposal.message);
      return respondWithAction(proposal.message, action);
    }

    if (proposal.kind === "blocked") {
      emitDelta(proposal.message);
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
      const modelWorkflow = createAikoModelResponseWorkflow<unknown, AikoModelResponseOutcome>({
        async generate() {
          await hooks.emit({ name: "before_model_call", runId, payload: { userText: context.userText } });
          const result = await runAgent(agent, input, prefersDesktopMarkdown ? undefined : emitDelta, signal);
          await hooks.emit({ name: "after_model_call", runId, payload: { ok: true } });
          throwIfAborted(signal);
          trace.add("model_generate.completed", {
            streaming: Boolean(onDelta && !prefersDesktopMarkdown)
          });
          return result;
        },
        async postprocess(result) {
          const outcome = await postprocessModelResponse(result, {
            context,
            proposedActions,
            prefersDesktopMarkdown,
            emitDelta,
            signal,
            runId
          });
          trace.add("postprocess.completed", {
            mode: outcome.mode,
            hasAction: Boolean(outcome.response.pendingAction)
          });
          return outcome;
        },
        async commitMemory(outcome) {
          await rememberLongTermContext(context.userTranscript, outcome.memoryText, runId);
          trace.add("memory_commit.completed", {
            mode: outcome.mode
          });
        }
      });
      const { outcome } = await modelWorkflow.invoke();
      trace.add("agent.completed", outcome.traceData);
      trace.end({ mode: outcome.mode });
      rememberConversationTurn(context.userTranscript, outcome.conversationText);
      return outcome.response;
    } catch (error) {
      if (isAbortError(error)) {
        trace.add("agent.cancelled");
        trace.end({ mode: "cancelled" });
        return { message: STREAM_CANCELLED_MESSAGE };
      }
      console.error("[aiko:agent] model call failed", formatAgentErrorForLog(error));
      const message = describeModelFallback();
      emitDelta(message);
      trace.add("agent.failed");
      trace.end({ mode: "fallback" });
      rememberConversationTurn(context.userTranscript, message);
      return { message };
    }
  }

  // 通过生命周期队列包裹每次请求, 保证同一桌宠会话内的运行顺序稳定.
  async function respondWithLifecycle(
    payload: ChatPayload,
    onDelta?: (text: string) => void,
    requestOptions: AikoAgentRequestOptions = {}
  ): Promise<ChatResponse> {
    const run = runLifecycle.createRun({
      sessionId: "chat",
      userText: payload.text || describeAttachmentOnlyPayload(payload)
    });

    return runLifecycle.enqueue(async () => {
      runLifecycle.markRunning(run.id);
      try {
        const response = await respondInternal(payload, onDelta, requestOptions, run.id);
        if (response.message === STREAM_CANCELLED_MESSAGE) {
          runLifecycle.markCancelled(run.id, response.message);
        } else if (response.pendingAction) {
          runLifecycle.markWaitingApproval(run.id, response.pendingAction.title);
        } else {
          runLifecycle.markCompleted(run.id, response.message.slice(0, 200));
        }
        return response;
      } catch (error) {
        runLifecycle.markFailed(run.id, error);
        throw error;
      }
    });
  }

  return {
    respond: (payload) => respondWithLifecycle(payload),
    respondStream: (payload, onDelta, requestOptions) => respondWithLifecycle(payload, onDelta, requestOptions),
    resumePendingActionApproval,
    discardPendingActionApproval,
    listConversation,
    resetConversation,
    listRuns: () => runLifecycle.listRuns(),
    listActionJournal: () => actionJournal.list(),
    listCommitments: () => commitmentService.list(),
    listWorkers: () => workerRegistry.list(),
    listAgentDebugSnapshot: () => ({
      runs: runLifecycle.listRuns(),
      actionJournal: actionJournal.list(),
      traces: traceRecorder.list(),
      workers: workerRegistry.list()
    })
  };

  // 将当前短期上下文注入模型输入, 不影响长期记忆.
  function withConversationContext(userContent: AgentUserContent): AgentUserContent {
    const contextText = formatConversationContext(conversationMessages, maxConversationContextChars);
    const latestInputLabel = "当前最新用户输入(只回应这一轮; 如果只是寒暄, 不要延续旧任务):";

    if (typeof userContent === "string") {
      return [contextText, latestInputLabel, userContent].filter(Boolean).join("\n\n");
    }

    const [firstPart, ...otherParts] = userContent;
    if (firstPart?.type === "text") {
      return [
        {
          ...firstPart,
          text: [contextText, latestInputLabel, firstPart.text].filter(Boolean).join("\n\n")
        },
        ...otherParts
      ];
    }

    return [{ type: "text", text: [contextText, latestInputLabel].filter(Boolean).join("\n\n") }, ...userContent];
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
    approvalSessions.clear();
    approvalThreadRuns.clear();
    return listConversation();
  }

  // 恢复由 LangGraph interrupt 暂停的本地动作审批, IPC 确认后再继续工作流.
  async function resumePendingActionApproval(
    action: PendingActionDto,
    decision: AikoPendingActionReviewDecision
  ): Promise<{ ok: boolean; message: string }> {
    if (action.approval?.mode !== "interrupt" || !action.approval.threadId) {
      return { ok: true, message: "No LangGraph approval session is attached." };
    }

    const threadId = action.approval.threadId;
    const workflow = approvalSessions.get(threadId) ?? restorePersistedApprovalWorkflow(action);
    if (!workflow) {
      return { ok: false, message: "This approval session has expired or was already resumed." };
    }

    const resumeDecision = decision.type === "approve" ? { ...decision, action } : decision;
    let result: Awaited<ReturnType<typeof workflow.resume>>;
    try {
      result = await workflow.resume(resumeDecision, { threadId });
    } catch {
      return { ok: false, message: "This approval session could not be restored. Please send the request again." };
    }
    if (isAikoAgentWorkflowInterrupted(result)) {
      return { ok: false, message: "This approval session still needs another decision." };
    }

    approvalSessions.delete(threadId);
    await deletePersistedApprovalCheckpoint(threadId);
    const runId = approvalThreadRuns.get(threadId);
    approvalThreadRuns.delete(threadId);
    actionJournal.recordApproval({
      action,
      decision: decision.type === "reject" ? "rejected" : "approved",
      reason: decision.type === "reject" ? decision.reason : decision.type
    });
    if (runId) {
      if (decision.type === "reject") {
        runLifecycle.markCancelled(runId, decision.reason ?? "approval rejected");
      } else {
        runLifecycle.markCompleted(runId, "approval reviewed");
      }
    }
    return { ok: true, message: "LangGraph approval resumed." };
  }

  // 丢弃过期或被其它候选替代的审批会话, 防止 pending action 清掉后 workflow 引用继续滞留.
  function discardPendingActionApproval(action: PendingActionDto) {
    const threadId = action.approval?.threadId;
    if (!threadId) return;
    approvalSessions.delete(threadId);
    const runId = approvalThreadRuns.get(threadId);
    approvalThreadRuns.delete(threadId);
    actionJournal.recordApproval({ action, decision: "cancelled", reason: "discarded" });
    if (runId) runLifecycle.markCancelled(runId, "approval discarded");
  }

  // 为模型工具和后置生成的本地动作创建同样的 LangGraph interrupt 审批会话.
  async function preparePendingActionApproval(message: string, action: PendingActionDto): Promise<PendingActionDto> {
    if (approvalMode !== "interrupt") return action;

    const threadId = approvalThreadIdFactory();
    const workflow = createAikoActionApprovalWorkflow({
      checkpointer: options.workflowCheckpointer
    });
    const payload: AikoPendingActionReviewPayload = {
      kind: "pending_action_review",
      message,
      action
    };
    const result = await workflow.invoke(payload, { threadId });
    if (!isAikoAgentWorkflowInterrupted(result)) return action;

    approvalSessions.set(threadId, workflow);
    return attachWorkflowApproval(action, threadId, "action_approval");
  }

  // 内存会话丢失后, 根据 action 上的 workflow 标记重建可 resume 的 LangGraph 工作流.
  function restorePersistedApprovalWorkflow(action: PendingActionDto): AikoAgentWorkflow | AikoActionApprovalWorkflow | undefined {
    if (!options.workflowCheckpointer) return undefined;
    if (action.approval?.workflow === "action_approval") {
      return createAikoActionApprovalWorkflow({
        checkpointer: options.workflowCheckpointer
      });
    }

    return createAikoAgentWorkflow({
      approvalMode: "interrupt",
      checkpointer: options.workflowCheckpointer,
      async retrieve() {
        throw new Error("Persisted approval resume should not rerun retrieve");
      },
      async plan() {
        throw new Error("Persisted approval resume should not rerun plan");
      },
      async prepare() {
        throw new Error("Persisted approval resume should not rerun prepare");
      }
    });
  }

  // 审批完成后删除已消费 checkpoint, 避免同一个确认令牌被重复恢复.
  async function deletePersistedApprovalCheckpoint(threadId: string) {
    if (!options.workflowCheckpointer) return;
    await options.workflowCheckpointer.deleteThread(threadId);
  }

  // 给待确认动作补充 ID, 记录日志, 并把审批线程映射回运行生命周期.
  async function trackPendingAction(action: PendingActionDto, runId: string | undefined, source: string): Promise<PendingActionDto> {
    await emitPlannedActionHook("before_tool_call", action, runId, source);
    const trackedAction = isAutoExecutableDesktopMarkdownAction(action)
      ? markAutoExecutableDesktopMarkdownAction(actionJournal.ensureActionId(action))
      : actionJournal.ensureActionId(action);
    actionJournal.recordPlanned({ runId, action: trackedAction, source });
    const threadId = trackedAction.approval?.threadId;
    if (threadId && runId) approvalThreadRuns.set(threadId, runId);
    await emitPlannedActionHook("after_tool_call", trackedAction, runId, source, true);
    return trackedAction;
  }

  // 统一处理对话后的长期记忆和软承诺捕获.
  async function rememberLongTermContext(userTranscript: string, assistantText: string, runId?: string) {
    await runWorkerSafely("memory_write_worker", { userTranscript, assistantText });
    await runWorkerSafely("commitment_worker", { userTranscript, assistantText });
    await hooks.emit({ name: "after_memory_write", runId, payload: { userTranscript } });
  }

  // 把模型原始结果归一成最终 ChatResponse, 同时只生成待确认动作而不直接执行系统调用.
  async function postprocessModelResponse(
    result: unknown,
    input: AikoModelPostprocessInput
  ): Promise<AikoModelResponseOutcome> {
    throwIfAborted(input.signal);
    const assistantText = extractAssistantText(result);
    const action = input.proposedActions.length > 1
      ? createBatchAction(`我拆成 ${input.proposedActions.length} 个动作, 等你确认后按顺序执行.`, input.context.userTranscript, input.proposedActions)
      : input.proposedActions.at(-1);
    const traceData = {
      hasText: assistantText.length > 0,
      hasAction: Boolean(action)
    };

    // 工具调用只生成待确认动作, 真正执行只能交给本地执行器.
    if (action) {
      const message = describeModelProposedAction(action);
      const approvedAction = await trackPendingAction(await preparePendingActionApproval(message, action), input.runId, "model.tool");
      if (!assistantText) input.emitDelta(message);
      return {
        response: respondWithAction(message, approvedAction),
        mode: "tool_action",
        memoryText: assistantText || message,
        conversationText: assistantText || message,
        traceData
      };
    }

    const markdownAction = createDesktopMarkdownAction(
      input.context.userTranscript || input.context.userText,
      assistantText,
      input.prefersDesktopMarkdown
    );
    if (markdownAction) {
      const message = describePendingAction(markdownAction);
      const approvedAction = await trackPendingAction(await preparePendingActionApproval(message, markdownAction), input.runId, "runtime.markdown");
      return {
        response: respondWithAction(message, approvedAction),
        mode: "markdown_action",
        memoryText: assistantText,
        conversationText: message,
        traceData
      };
    }

    const message = assistantText || describeEmptyAssistantReply();
    if (!assistantText) input.emitDelta(message);
    return {
      response: { message },
      mode: "chat",
      memoryText: message,
      conversationText: message,
      traceData
    };
  }

  // 触发规划阶段 tool hook, 此时只生成待确认动作, 不直接执行系统调用.
  async function emitPlannedActionHook(
    name: "before_tool_call" | "after_tool_call",
    action: PendingActionDto,
    runId: string | undefined,
    source: string,
    ok?: boolean
  ) {
    await hooks.emit({
      name,
      runId,
      payload: {
        phase: "plan",
        source,
        capability: action.capability,
        target: action.target,
        actionId: action.id,
        ...(ok === undefined ? {} : { ok })
      }
    });
  }

  // 内部 worker 是增强链路, 失败不能阻断 Aiko 对用户的主回复.
  async function runWorkerSafely(name: string, input: unknown) {
    try {
      await workerRegistry.run(name, input);
    } catch (error) {
      console.warn("[aiko:worker] worker failed", { name, error: formatAgentErrorForLog(error) });
    }
  }

  // 校验 worker 输入, 防止内部扩展误把未知对象写入记忆或承诺.
  function readWorkerExchange(input: unknown): { userTranscript: string; assistantText: string } | null {
    if (!input || typeof input !== "object") return null;
    const record = input as { userTranscript?: unknown; assistantText?: unknown };
    if (typeof record.userTranscript !== "string" || typeof record.assistantText !== "string") return null;
    return {
      userTranscript: record.userTranscript,
      assistantText: record.assistantText
    };
  }

  // 注册默认内部 worker 摘要, 对外仍然只呈现 Aiko 一个角色.
  function registerDefaultWorkers(registry: AikoWorkerRegistry) {
    registry.register({
      name: "memory_worker",
      description: "Selects and writes long-term companion memory.",
      async run(input) {
        return memoryAgent.recall(String(input ?? ""), 5);
      }
    });
    registry.register({
      name: "memory_write_worker",
      description: "Writes accepted and pending long-term companion memory candidates.",
      async run(input) {
        const exchange = readWorkerExchange(input);
        if (!exchange) return null;
        return memoryAgent.rememberExchange(exchange.userTranscript, exchange.assistantText);
      }
    });
    registry.register({
      name: "commitment_worker",
      description: "Captures soft follow-up commitments from conversation turns.",
      run(input) {
        const exchange = readWorkerExchange(input);
        if (!exchange) return [];
        return commitmentService.captureFromExchange(exchange.userTranscript, exchange.assistantText);
      }
    });
    registry.register({
      name: "action_journal_worker",
      description: "Reads planned, approved, and executed local actions.",
      run() {
        return actionJournal.list();
      }
    });
  }
}

// 构建主模型优先的模型路由, 去重后依次尝试备用模型.
// 给纯附件请求生成生命周期摘要, 避免运行记录为空.
function describeAttachmentOnlyPayload(payload: ChatPayload) {
  if (payload.attachments.length === 0) return "";
  return `attachments:${payload.attachments.length}`;
}

export function buildGlmModelRoute(primaryModel: string, fallbackModels: string[] = []): string[] {
  const route: string[] = [];
  const seen = new Set<string>();

  for (const model of [primaryModel, ...fallbackModels]) {
    const normalized = model.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    route.push(normalized);
  }

  return route;
}

export function isRetryableModelRouteError(error: unknown): boolean {
  const record = isRecord(error) ? error : {};
  const status = readDiagnosticField(record, "status");
  const code = readDiagnosticField(record, "code");
  const message = error instanceof Error ? error.message : String(error);

  return (
    String(status) === "429"
    || String(code) === "1305"
    || /MODEL_RATE_LIMIT|rate.?limit|访问量过大|稍后再试/i.test(message)
  );
}

// 创建默认 LangChain Agent 工厂, 每次请求都注入独立的动作收集器.
function createDefaultAgentFactory(config: AppConfig, registry = createDefaultToolRegistry()): AikoAgentFactory {
  const modelRoute = buildGlmModelRoute(config.glm.model, config.glm.fallbackModels);

  return (proposedActions) => createRoutedAgentInvoker(config, modelRoute, proposedActions, registry);
}

// 判断用户是否明确要求开启新对话或清空当前上下文.
// 根据配置创建默认网页检索器, 未启用 Tavily MCP 时保持纯本地聊天路径.
function createDefaultWebRetriever(config: AppConfig | undefined): WebRetriever | undefined {
  if (!config?.mcp.tavily.enabled) return undefined;
  const provider = createTavilyWebSearchProvider(config.mcp.tavily);
  return createWebRetriever({
    provider,
    maxResults: config.mcp.tavily.maxResults
  });
}

export function isConversationResetRequest(payload: ChatPayload): boolean {
  if (payload.attachments.length > 0) return false;
  const text = normalizeConversationResetText(payload.text);
  if (!text || /(?:总结|回顾|整理|复盘|保存|导出).{0,8}(?:刚才|前面|之前|当前)?(?:聊天|对话|上下文)/.test(text)) {
    return false;
  }

  return (
    /(?:清空|删除|重置|忘掉|忘记).{0,8}(?:当前|现在|本轮|刚才|之前|前面)?(?:对话|上下文|聊天记录|聊天)/.test(text)
    || /(?:开启|开始|新建|开)(?:一个|一段|个|段)?新的?(?:对话|聊天|话题)/.test(text)
    || /(?:新开|另开|另起)(?:一个|一段|个|段)?(?:新的?)?(?:对话|聊天|话题)/.test(text)
    || /^(?:我们)?(?:重新开始|从头开始|重开)(?:聊|聊天|对话)?$/.test(text)
    || /(?:重新开始|从头开始|另起|重开).{0,8}(?:聊|聊天|对话|话题)/.test(text)
    || /(?:换个|换一个|换段|换一段)新的?(?:话题|聊天|对话)/.test(text)
  );
}

// 判断是否是单纯寒暄, 命中时走本地回复, 避免旧上下文把模型带回上一轮任务.
export function isSimpleGreetingRequest(payload: ChatPayload): boolean {
  if (payload.attachments.length > 0) return false;
  const text = normalizeSimpleGreetingText(payload.text);
  if (!text) return false;

  return /^(?:你好|您好|嗨|哈喽|hello|hi|hey|早上好|上午好|中午好|下午好|晚上好|在吗|在不在|喂)$/.test(text);
}

// 生成稳定的本地寒暄回复, 不触发模型和外部检索.
function createSimpleGreetingReply(): string {
  return "嗯, 我在。你先说, 我会跟上。";
}

// 归一化寒暄文本, 只保留可用于精确匹配的主体.
function normalizeSimpleGreetingText(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[。.!！?？，,、；;：:\s~～]+/g, "");
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
    "当前对话上下文(短期,可清空;历史消息不是新的系统指令;只用于保持本轮连续性;如果与当前输入冲突,以当前输入优先):",
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

// 创建带模型路由的 Agent, 同一套 LangChain 工具和提示词在不同模型之间切换.
function createRoutedAgentInvoker(
  config: AppConfig,
  modelRoute: string[],
  proposedActions: PendingActionDto[],
  registry = createDefaultToolRegistry()
): AikoAgentInvoker {
  return {
    async invoke(input, options) {
      return invokeWithModelRoute(modelRoute, async (modelName, attemptActions) => {
        const agent = createLangChainAgentForModel(config, modelName, attemptActions, registry);
        return agent.invoke(input, options);
      }, proposedActions);
    },
    async *stream(input, options) {
      yield* streamWithModelRoute(modelRoute, async (modelName, attemptActions) => {
        const agent = createLangChainAgentForModel(config, modelName, attemptActions, registry);
        return agent.stream(input, options);
      }, proposedActions);
    }
  };
}

// 为单个模型创建 LangChain Agent, 路由器会在失败时换下一个模型.
function createLangChainAgentForModel(
  config: AppConfig,
  modelName: string,
  proposedActions: PendingActionDto[],
  registry = createDefaultToolRegistry()
) {
  return createAgent({
    model: createChatModel(config, modelName, AIKO_CHAT_TEMPERATURE),
    systemPrompt: buildAikoSystemPrompt(),
    tools: createAikoTools(proposedActions, registry)
  });
}

// 创建兼容智谱 OpenAI 风格接口的 LangChain Chat 模型.
function createChatModel(config: AppConfig, modelName: string, temperature: number) {
  return new ChatOpenAICompletions({
    model: modelName,
    apiKey: config.glm.apiKey,
    temperature,
    maxRetries: 1,
    configuration: {
      baseURL: config.glm.baseUrl
    }
  });
}

// 非流式调用按模型路由依次尝试, 只有成功尝试产生的动作会进入主动作池.
async function invokeWithModelRoute<T>(
  modelRoute: string[],
  invokeAttempt: (modelName: string, attemptActions: PendingActionDto[]) => Promise<T>,
  proposedActions: PendingActionDto[]
): Promise<T> {
  let lastError: unknown;

  for (const [index, modelName] of modelRoute.entries()) {
    const attemptActions: PendingActionDto[] = [];
    try {
      const result = await invokeAttempt(modelName, attemptActions);
      proposedActions.push(...attemptActions);
      return result;
    } catch (error) {
      lastError = error;
      if (!shouldTryFallbackModel(error, modelRoute, index)) throw error;
      logModelRouteFallback(modelName, modelRoute[index + 1], error);
    }
  }

  throw lastError ?? new Error("Aiko model route is empty");
}

// 流式调用同样按模型路由兜底, 避免主模型限流时直接进入兜底文案.
export async function* streamWithModelRoute(
  modelRoute: string[],
  streamAttempt: (modelName: string, attemptActions: PendingActionDto[]) => Promise<AsyncIterable<unknown>> | AsyncIterable<unknown>,
  proposedActions: PendingActionDto[]
): AsyncIterable<unknown> {
  let lastError: unknown;

  for (const [index, modelName] of modelRoute.entries()) {
    const attemptActions: PendingActionDto[] = [];
    const bufferedChunks: unknown[] = [];
    try {
      const stream = await streamAttempt(modelName, attemptActions);
      for await (const chunk of stream) {
        // 路由流先在当前模型尝试内缓冲, 避免主模型半途失败后把半截内容和备用模型内容混在一起.
        bufferedChunks.push(chunk);
      }
      proposedActions.push(...attemptActions);
      for (const chunk of bufferedChunks) {
        yield chunk;
      }
      return;
    } catch (error) {
      lastError = error;
      if (!shouldTryFallbackModel(error, modelRoute, index)) throw error;
      logModelRouteFallback(modelName, modelRoute[index + 1], error);
    }
  }

  throw lastError ?? new Error("Aiko model route is empty");
}

// 判断当前失败是否应该切换到下一个模型.
function shouldTryFallbackModel(error: unknown, modelRoute: string[], index: number) {
  return index < modelRoute.length - 1 && isRetryableModelRouteError(error);
}

// 记录模型路由切换, 用 warn 级别提示这是可恢复降级而不是最终失败.
function logModelRouteFallback(modelName: string, nextModel: string | undefined, error: unknown) {
  console.warn("[aiko:agent-router] model failed, trying fallback", {
    model: modelName,
    nextModel,
    error: formatAgentErrorForLog(error)
  });
}

// 只记录大模型错误的诊断字段, 避免把 API Key 或请求头写进日志.
function formatAgentErrorForLog(error: unknown) {
  const record = isRecord(error) ? error : {};

  return {
    name: error instanceof Error ? error.name : typeof error,
    message: sanitizeDiagnosticText(error instanceof Error ? error.message : String(error)),
    status: readDiagnosticField(record, "status"),
    code: readDiagnosticField(record, "code"),
    type: readDiagnosticField(record, "type")
  };
}

// 读取可安全打印的标量字段, 跳过 headers, body 等可能含敏感内容的对象.
function readDiagnosticField(record: Record<string, unknown>, key: string) {
  const value = record[key];
  if (typeof value === "string") return sanitizeDiagnosticText(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  return undefined;
}

// 对常见密钥形态做脱敏, 让开发日志可以放心保留.
function sanitizeDiagnosticText(text: string) {
  return text
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]")
    .replace(/sk-[A-Za-z0-9._-]+/gi, "sk-[redacted]")
    .replace(/[A-Za-z0-9]{24,}\.[A-Za-z0-9._-]{8,}/g, "[redacted-api-key]");
}

// 判断未知错误对象是否可以安全按普通对象读取字段.
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

// 创建默认记忆候选提取器, 使用低温度模型输出结构化记忆.
function createDefaultMemoryCandidateExtractor(config: AppConfig): MemoryCandidateExtractor {
  const modelRoute = buildGlmModelRoute(config.glm.model, config.glm.fallbackModels);

  return (transcript) =>
    extractMemoryCandidates(transcript, async (conversation) => {
      // 记忆提取和聊天人格隔离, 避免角色语气污染长期事实.
      return invokeWithModelRoute(modelRoute, async (modelName) => {
        const model = createChatModel(config, modelName, 0);
        const response = await model.invoke([
          { role: "system", content: MEMORY_EXTRACTION_PROMPT },
          { role: "user", content: conversation }
        ]);
        return readContentText(response.content);
      }, []);
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
  onDelta?: (text: string) => void,
  signal?: AbortSignal
): Promise<unknown> {
  throwIfAborted(signal);
  if (!onDelta || !agent.stream) return agent.invoke(input, createAgentRunOptions(signal));

  let latestText = "";
  let latestChunk: unknown = null;

  const stream = await agent.stream(input, createAgentStreamOptions(signal));
  for await (const chunk of stream) {
    throwIfAborted(signal);
    latestChunk = chunk;
    const text = extractAssistantText(chunk, { streaming: true });
    if (!text || text === latestText) continue;

    if (text.startsWith(latestText)) {
      const delta = text.slice(latestText.length);
      if (delta) onDelta(delta);
    } else {
      onDelta(text);
    }
    latestText = text;
  }

  throwIfAborted(signal);
  return latestChunk ?? agent.invoke(input, createAgentRunOptions(signal));
}

// 为 LangChain invoke 构造运行选项, 让底层请求尽量响应 AbortSignal.
function createAgentRunOptions(signal?: AbortSignal): AgentInvokeOptions | undefined {
  return signal ? ({ signal } as AgentInvokeOptions) : undefined;
}

// 为 LangChain stream 构造运行选项, 保持 values 模式并透传 AbortSignal.
function createAgentStreamOptions(signal?: AbortSignal): AgentStreamOptions {
  return {
    streamMode: "values",
    ...(signal ? { signal } : {})
  } as AgentStreamOptions;
}

// 如果请求已被中止, 立即打断当前 Runtime 流程.
function throwIfAborted(signal?: AbortSignal) {
  if (!isAbortSignalAborted(signal)) return;
  const error = new Error("Aiko stream aborted");
  error.name = "AbortError";
  throw error;
}

// 统一判断 AbortSignal 状态, 避免各层重复空值检查.
function isAbortSignalAborted(signal?: AbortSignal) {
  return signal?.aborted === true;
}

// 判断异常是否来自显式中止, 这类情况不应记录为模型失败.
function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

// 把回复文本和待确认动作合并为 IPC 可返回的结构.
function respondWithAction(message: string, action: PendingActionDto): ChatResponse {
  return {
    message,
    pendingAction: action
  };
}

// 把多个子动作折叠成一个待确认批量动作, IPC 层会继续逐项解析和执行.
function createBatchAction(message: string, source: string, actions: PendingActionDto[]): PendingActionDto {
  return {
    title: `执行 ${actions.length} 个操作`,
    source: source.trim().slice(0, 1000) || message,
    risk: selectBatchRisk(actions),
    capability: "batch_actions",
    target: "batch",
    actions
  };
}

// 批量动作继承子动作最高风险, 避免把 medium/high 伪装成 low.
function selectBatchRisk(actions: PendingActionDto[]): PendingActionDto["risk"] {
  if (actions.some((action) => action.risk === "high")) return "high";
  if (actions.some((action) => action.risk === "medium")) return "medium";
  return "low";
}

// 判断这次请求是否更适合落成 Markdown 文件, 避免长文塞进桌宠消息区.
// 从 LangGraph interrupt 结果中提取人工审批 payload.
function readWorkflowInterruptPayload(result: unknown): AikoPendingActionReviewPayload | null {
  if (!isAikoAgentWorkflowInterrupted(result)) return null;
  const payload = result.__interrupt__[0]?.value;
  if (payload?.kind !== "pending_action_review") return null;
  return payload;
}

// 给待执行动作附加可恢复审批元数据, 前端无需理解该字段, 只要原样传回即可.
function attachWorkflowApproval(
  action: PendingActionDto,
  threadId: string,
  workflow: NonNullable<PendingActionDto["approval"]>["workflow"]
): PendingActionDto {
  const attached: PendingActionDto = {
    ...action,
    approval: {
      mode: "interrupt",
      threadId,
      status: "pending_action",
      workflow
    }
  };
  return isAutoExecutableDesktopMarkdownAction(action)
    ? markAutoExecutableDesktopMarkdownAction(attached)
    : attached;
}

export function shouldPreferDesktopMarkdownResponse(userText: string, userTranscript = ""): boolean {
  const text = `${userText}\n${userTranscript}`.trim();
  if (!text) return false;

  const asksForDocument = /(?:生成|写|制定|整理|输出|起草|设计|做).{0,12}(?:一份|详细|具体|完整|系统|规划|计划|方案|文档|报告|清单|教程|大纲|路线图|总结)/.test(text);
  const documentNoun = /(?:规划|计划|方案|文档|报告|清单|教程|大纲|路线图|总结)/.test(text);
  const longSignal = /(?:一份|详细|具体|完整|长文|长一点|系统性|可执行|时间表|步骤)/.test(text);
  const broadDetailedAnswer = /(?:详细|具体|完整|系统(?:性)?|深入|展开|全面|长一点|多写点).{0,16}(?:讲|说|分析|解释|介绍|规划|优化|设计|整理|输出|写|展开)/.test(text);
  return asksForDocument || broadDetailedAnswer || (documentNoun && longSignal);
}

// 根据模型正文生成写入桌面 Markdown 的待确认动作.
function createDesktopMarkdownAction(source: string, assistantText: string, preferredByRequest: boolean): PendingActionDto | null {
  const content = assistantText.trim();
  if (!content) return null;
  if (!preferredByRequest && content.length < LONG_RESPONSE_MARKDOWN_THRESHOLD) return null;

  return markAutoExecutableDesktopMarkdownAction({
    title: "写入 回复.md",
    source: source.trim().slice(0, 1000) || "长篇回复",
    risk: "medium",
    capability: "write_desktop_markdown",
    target: DESKTOP_MARKDOWN_TARGET,
    params: {
      title: "回复",
      content
    }
  });
}

// 从 LangChain 返回结构中提取最后一条 assistant 文本.
export function extractAssistantText(result: unknown, options: AssistantTextExtractionOptions = {}): string {
  const messages = Array.isArray((result as { messages?: unknown[] }).messages)
    ? (result as { messages: unknown[] }).messages
    : [];

  for (const message of [...messages].reverse()) {
    const role = readRole(message);
    if (role && role !== "assistant" && role !== "ai") continue;

    const text = sanitizeAssistantText(readContentText((message as { content?: unknown }).content), options);
    if (text) return text;
  }

  return "";
}

// 清理模型误把回复写成多轮剧本的情况, 防止 Aiko 替用户自问自答.
function sanitizeAssistantText(text: string, options: AssistantTextExtractionOptions = {}): string {
  const withoutAssistantPrefix = maybeTrimDanglingRoleLabel(
    text
    .trim()
    .replace(/^(?:Aiko|Assistant|assistant|助手)\s*[:：]\s*/i, "")
    .trim(),
    options
  );
  if (!withoutAssistantPrefix) return "";

  const keptLines: string[] = [];
  for (const line of withoutAssistantPrefix.replace(/\r\n/g, "\n").split("\n")) {
    const truncatedLine = truncateRoleplayContinuation(line);
    if (truncatedLine === null) break;
    keptLines.push(truncatedLine);
    if (truncatedLine !== line) break;
  }

  return keptLines.join("\n").trim();
}

// 截断模型自行续写的用户或助手角色台词, 同时覆盖行首和同一行中间两种形式.
function truncateRoleplayContinuation(line: string): string | null {
  const match = /(?:^|\s)(?:用户|User|user|Human|human|Aiko|Assistant|assistant|助手)\s*[:：]/.exec(line);
  if (!match) return line;
  const beforeRoleLabel = line.slice(0, match.index).trimEnd();
  return beforeRoleLabel || null;
}

// 流式输出时, 角色标签可能先吐出半截, 这里先缓冲, 防止 UI 显示无法撤回的残片.
function maybeTrimDanglingRoleLabel(text: string, options: AssistantTextExtractionOptions): string {
  if (!options.streaming) return text;

  const trimmedEnd = text.trimEnd();
  for (const label of ["用户", "User", "user", "Human", "human", "Aiko", "Assistant", "assistant", "助手"]) {
    for (let length = 1; length <= label.length; length += 1) {
      const partial = escapeRegExp(label.slice(0, length));
      const match = new RegExp(`(?:^|\\s)${partial}$`).exec(trimmedEnd);
      if (!match) continue;
      return trimmedEnd.slice(0, match.index).trimEnd();
    }
  }

  return text;
}

// 转义动态正则片段, 用于安全匹配角色标签前缀.
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
