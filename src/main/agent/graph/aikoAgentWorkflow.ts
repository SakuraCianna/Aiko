import { Command, MemorySaver, entrypoint, interrupt, task } from "@langchain/langgraph";
import type { BaseCheckpointSaver } from "@langchain/langgraph";
import type { ChatPayload } from "../../../shared/chatPayload";
import type { ExecuteActionResponse, PendingActionDto } from "../../../shared/ipcTypes";
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
export type AikoModelResponseWorkflowStepName = "model_generate" | "postprocess" | "memory_commit";
export type AikoActionExecutionWorkflowStepName = "approval_resume" | "tool_execute";

export type AikoAgentWorkflowApprovalMode = "passive" | "interrupt";

export type AikoPendingActionReviewPayload = {
  kind: "pending_action_review";
  message: string;
  action: PendingActionDto;
};

export type AikoPendingActionReviewDecision =
  | {
      type: "approve";
      action?: PendingActionDto;
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
export type AikoActionApprovalWorkflowResult = {
  approval: AikoAgentWorkflowApproval;
  stepNames: ["review"];
};

export type AikoActionApprovalWorkflowOutput = AikoActionApprovalWorkflowResult | AikoAgentWorkflowInterruptResult;

export type AikoActionApprovalWorkflow = {
  invoke: (
    payload: AikoPendingActionReviewPayload,
    options?: AikoAgentWorkflowInvokeOptions
  ) => Promise<AikoActionApprovalWorkflowOutput>;
  resume: (
    decision: AikoPendingActionReviewDecision,
    options: AikoAgentWorkflowInvokeOptions
  ) => Promise<AikoActionApprovalWorkflowOutput>;
};

export type AikoModelResponseWorkflowDeps<ModelResult, Outcome> = {
  generate: () => Promise<ModelResult>;
  postprocess: (result: ModelResult) => Promise<Outcome>;
  commitMemory: (outcome: Outcome) => Promise<void>;
  checkpointer?: BaseCheckpointSaver;
};

export type AikoModelResponseWorkflowResult<Outcome> = {
  outcome: Outcome;
  stepNames: AikoModelResponseWorkflowStepName[];
};

export type AikoModelResponseWorkflow<Outcome> = {
  invoke: () => Promise<AikoModelResponseWorkflowResult<Outcome>>;
};

export type AikoActionExecutionWorkflowDeps = {
  resumeApproval: () => Promise<ExecuteActionResponse>;
  execute: () => Promise<ExecuteActionResponse>;
  checkpointer?: BaseCheckpointSaver;
};

export type AikoActionExecutionWorkflowResult = {
  response: ExecuteActionResponse;
  stepNames: AikoActionExecutionWorkflowStepName[];
};

export type AikoActionExecutionWorkflow = {
  invoke: () => Promise<AikoActionExecutionWorkflowResult>;
};

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

  const workflow = entrypoint(createEntrypointOptions("aikoAgentWorkflow", checkpointer), async (payload: ChatPayload) => {
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

// 创建本地动作执行工作流, 保证审批恢复成功后才触发系统能力.
export function createAikoActionExecutionWorkflow(
  deps: AikoActionExecutionWorkflowDeps
): AikoActionExecutionWorkflow {
  const resumeApproval = task("approval_resume", async () => {
    return deps.resumeApproval();
  });

  const executeTool = task("tool_execute", async () => {
    return deps.execute();
  });

  const workflow = entrypoint(createEntrypointOptions("aikoActionExecutionWorkflow", deps.checkpointer), async () => {
    const approval = await resumeApproval();
    if (!approval.ok) {
      return {
        response: approval,
        stepNames: ["approval_resume"] satisfies AikoActionExecutionWorkflowStepName[]
      };
    }

    return {
      response: await executeTool(),
      stepNames: ["approval_resume", "tool_execute"] satisfies AikoActionExecutionWorkflowStepName[]
    };
  });

  return {
    // 内部执行流同样用非空输入启动, 满足 LangGraph entrypoint 的输入写入要求.
    async invoke() {
      return await workflow.invoke({});
    }
  };
}

// 创建模型回复工作流, 把生成, 后处理和记忆提交变成显式 LangGraph task.
export function createAikoModelResponseWorkflow<ModelResult, Outcome>(
  deps: AikoModelResponseWorkflowDeps<ModelResult, Outcome>
): AikoModelResponseWorkflow<Outcome> {
  const generateModel = task("model_generate", async () => {
    return deps.generate();
  });

  const postprocessResponse = task("postprocess", async (result: ModelResult) => {
    return deps.postprocess(result);
  });

  const commitMemory = task("memory_commit", async (outcome: Outcome) => {
    await deps.commitMemory(outcome);
    return outcome;
  });

  const workflow = entrypoint(createEntrypointOptions("aikoModelResponseWorkflow", deps.checkpointer), async () => {
    const modelResult = await generateModel();
    const outcome = await postprocessResponse(modelResult);
    await commitMemory(outcome);

    return {
      outcome,
      stepNames: ["model_generate", "postprocess", "memory_commit"] satisfies AikoModelResponseWorkflowStepName[]
    };
  });

  return {
    // 模型回复链路没有用户审批 interrupt, 但保留 Functional API 边界方便后续 checkpoint 化.
    async invoke() {
      return await workflow.invoke({});
    }
  };
}

// 判断 LangGraph 返回值是否是中断结果, 方便 runtime 保持兼容模式.
// 创建只负责人审动作的轻量工作流, 用于模型工具或自动 Markdown 动作生成后的统一审批.
export function createAikoActionApprovalWorkflow(options: {
  checkpointer?: BaseCheckpointSaver;
} = {}): AikoActionApprovalWorkflow {
  const checkpointer = options.checkpointer ?? new MemorySaver();
  const prepareReview = task("review", async (payload: AikoPendingActionReviewPayload) => {
    return payload;
  });
  const workflow = entrypoint(createEntrypointOptions("aikoActionApprovalWorkflow", checkpointer), async (
    payload: AikoPendingActionReviewPayload
  ) => {
    const reviewPayload = await prepareReview(payload);
    return {
      approval: reviewPendingAction(reviewPayload, "interrupt"),
      stepNames: ["review"] as ["review"]
    };
  });

  return {
    // 暂停一个后置生成的本地动作, 与主请求 workflow 使用同样的 interrupt/resume 语义.
    async invoke(payload, options) {
      const result = await workflow.invoke(payload, createWorkflowConfig("interrupt", options));
      return result as AikoActionApprovalWorkflowOutput;
    },

    // 恢复后置审批 workflow, approve/reject/respond 都通过同一条 LangGraph resume 通道进入.
    async resume(decision, options) {
      const result = await workflow.invoke(new Command({ resume: decision }), createWorkflowConfig("interrupt", options));
      return result as AikoActionApprovalWorkflowOutput;
    }
  };
}

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
function createEntrypointOptions(name: string, checkpointer: BaseCheckpointSaver | undefined) {
  if (!checkpointer) return name;
  return {
    name,
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
