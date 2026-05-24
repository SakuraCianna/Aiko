import { Command, MemorySaver, entrypoint, interrupt, task } from "@langchain/langgraph";
import type { BaseCheckpointSaver } from "@langchain/langgraph";
import type { ChatPayload } from "../../../shared/chatPayload";
import type { PendingActionDto } from "../../../shared/ipcTypes";
import type { AikoPlan, ExecutionProposal, RetrievedContext } from "../types";

export type AikoAgentWorkflowDeps = {
  retrieve: (payload: ChatPayload) => Promise<RetrievedContext>;
  plan: (context: RetrievedContext) => Promise<AikoPlan>;
  prepare: (plan: AikoPlan) => Promise<ExecutionProposal>;
  approvalMode?: AikoAgentWorkflowApprovalMode;
  checkpointer?: BaseCheckpointSaver;
};

export type AikoAgentWorkflowResult = {
  context: RetrievedContext;
  plan: AikoPlan;
  proposal: ExecutionProposal;
  approval: AikoAgentWorkflowApproval;
  stepNames: AikoAgentWorkflowStepName[];
};

export type AikoAgentWorkflowStepName = "retrieve" | "plan" | "prepare" | "review";

export type AikoAgentWorkflowApprovalMode = "passive" | "interrupt";

export type AikoPendingActionReviewPayload = {
  kind: "pending_action_review";
  message: string;
  action: PendingActionDto;
};

export type AikoPendingActionReviewDecision =
  | {
      type: "approve";
    }
  | {
      type: "reject";
      reason?: string;
    }
  | {
      type: "respond";
      message: string;
    };

export type AikoAgentWorkflowApproval =
  | {
      status: "not_required";
    }
  | {
      status: "pending_action";
      payload: AikoPendingActionReviewPayload;
    }
  | {
      status: "reviewed";
      payload: AikoPendingActionReviewPayload;
      decision: AikoPendingActionReviewDecision;
    };

export type AikoAgentWorkflowInterruptResult = {
  __interrupt__: Array<{
    id: string;
    value: AikoPendingActionReviewPayload;
  }>;
};

export type AikoAgentWorkflowOutput = AikoAgentWorkflowResult | AikoAgentWorkflowInterruptResult;

export type AikoAgentWorkflowInvokeOptions = {
  threadId?: string;
};

export type AikoAgentWorkflow = {
  invoke: (payload: ChatPayload, options?: AikoAgentWorkflowInvokeOptions) => Promise<AikoAgentWorkflowOutput>;
  resume: (
    decision: AikoPendingActionReviewDecision,
    options: AikoAgentWorkflowInvokeOptions
  ) => Promise<AikoAgentWorkflowOutput>;
};

// 创建 LangGraph Functional API 工作流, 作为 Aiko 请求生命周期的显式编排边界.
export function createAikoAgentWorkflow(deps: AikoAgentWorkflowDeps): AikoAgentWorkflow {
  const approvalMode = deps.approvalMode ?? "passive";
  const checkpointer = approvalMode === "interrupt" ? deps.checkpointer ?? new MemorySaver() : deps.checkpointer;
  const retrieveContext = task("retrieve", async (payload: ChatPayload) => {
    return deps.retrieve(payload);
  });

  const planRequest = task("plan", async (context: RetrievedContext) => {
    return deps.plan(context);
  });

  const prepareExecution = task("prepare", async (plan: AikoPlan) => {
    return deps.prepare(plan);
  });

  const prepareReview = task("review", async (proposal: ExecutionProposal) => {
    return createPendingActionReviewPayload(proposal);
  });

  const workflow = entrypoint(createEntrypointOptions(checkpointer), async (payload: ChatPayload) => {
    const context = await retrieveContext(payload);
    const plan = await planRequest(context);
    const proposal = await prepareExecution(plan);
    const reviewPayload = await prepareReview(proposal);
    const approval = reviewPayload ? reviewPendingAction(reviewPayload, approvalMode) : { status: "not_required" as const };

    return {
      context,
      plan,
      proposal,
      approval,
      stepNames: ["retrieve", "plan", "prepare", "review"] satisfies AikoAgentWorkflowStepName[]
    };
  });

  return {
    // 只把聊天 payload 作为 graph 输入, 依赖函数留在闭包里, 方便未来换成可持久化 checkpoint.
    async invoke(payload, options) {
      const result = await workflow.invoke(payload, createWorkflowConfig(approvalMode, options));
      return result as AikoAgentWorkflowOutput;
    },

    // 恢复 interrupt 模式下暂停的工作流, 后续可接入现有确认 UI 的执行结果.
    async resume(decision, options) {
      const result = await workflow.invoke(new Command({ resume: decision }), createWorkflowConfig(approvalMode, options));
      return result as AikoAgentWorkflowOutput;
    }
  };
}

// 判断 LangGraph 返回值是否是中断结果, 方便 runtime 保持兼容模式.
export function isAikoAgentWorkflowInterrupted(value: unknown): value is AikoAgentWorkflowInterruptResult {
  return Boolean(
    value &&
      typeof value === "object" &&
      Array.isArray((value as { __interrupt__?: unknown }).__interrupt__)
  );
}

// 根据 pending action 生成可序列化的人审 payload.
function createPendingActionReviewPayload(proposal: ExecutionProposal): AikoPendingActionReviewPayload | null {
  if (proposal.kind !== "pending_action") return null;
  return {
    kind: "pending_action_review",
    message: proposal.message,
    action: proposal.action
  };
}

// passive 模式保持现有 IPC 确认流, interrupt 模式交给 LangGraph 暂停和恢复.
function reviewPendingAction(
  payload: AikoPendingActionReviewPayload,
  mode: AikoAgentWorkflowApprovalMode
): AikoAgentWorkflowApproval {
  if (mode === "passive") {
    return {
      status: "pending_action",
      payload
    };
  }

  const decision = interrupt<AikoPendingActionReviewPayload, AikoPendingActionReviewDecision>(payload);
  return {
    status: "reviewed",
    payload,
    decision
  };
}

// 根据是否启用 checkpointer 创建 entrypoint 配置.
function createEntrypointOptions(checkpointer: BaseCheckpointSaver | undefined) {
  if (!checkpointer) return "aikoAgentWorkflow";
  return {
    name: "aikoAgentWorkflow",
    checkpointer
  };
}

// interrupt 模式必须使用 threadId, 这样后续 Command resume 能找回同一个 checkpoint.
function createWorkflowConfig(mode: AikoAgentWorkflowApprovalMode, options?: AikoAgentWorkflowInvokeOptions) {
  if (mode === "interrupt" && !options?.threadId) {
    throw new Error("AikoAgentWorkflow interrupt mode requires a threadId");
  }
  return options?.threadId
    ? {
        configurable: {
          thread_id: options.threadId
        }
      }
    : undefined;
}
