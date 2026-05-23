import type { AikoPlan, ExecutionProposal } from "../types";
import { describeActionFailure } from "../../ai/aikoVoice";

export type AikoExecutor = {
  prepare: (plan: AikoPlan) => Promise<ExecutionProposal>;
};

// 创建 Agent 执行准备器, 负责把计划转换为待执行提案.
export function createAikoExecutor(): AikoExecutor {
  return {
    // 准备执行计划, 但不直接调用 Windows 本地能力.
    async prepare(plan) {
      const actionStep = plan.steps.find((step) => step.kind === "action");
      if (!actionStep) {
        return {
          kind: "none",
          message: plan.replyDraft
        };
      }

      if (actionStep.action.risk === "high") {
        return {
          kind: "blocked",
          message: describeActionFailure(actionStep.action, "high_risk")
        };
      }

      return {
        kind: "pending_action",
        message: plan.replyDraft,
        action: actionStep.action
      };
    }
  };
}
