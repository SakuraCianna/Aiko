import type { AikoPlan, ExecutionProposal } from "../types";
import { describeActionFailure } from "../../ai/aikoVoice";
import { createDefaultCapabilityPolicy, evaluateCapabilityPolicy } from "../policy/capabilityPolicy";
import type { AikoCapabilityPolicy } from "../policy/capabilityPolicy";

export type AikoExecutor = {
  prepare: (plan: AikoPlan) => Promise<ExecutionProposal>;
};

// 创建 Agent 执行准备器, 负责把计划转换为待执行提案.
export function createAikoExecutor(policy: AikoCapabilityPolicy = createDefaultCapabilityPolicy()): AikoExecutor {
  return {
    // 准备执行计划, 但不直接调用 Windows 本地能力.
    async prepare(plan) {
      const actionSteps = plan.steps.filter((step) => step.kind === "action");
      if (actionSteps.length === 0) {
        return {
          kind: "none",
          message: plan.replyDraft
        };
      }

      const deniedStep = actionSteps.find((step) => !evaluateCapabilityPolicy(step.action, policy).allowed);
      if (deniedStep) {
        return {
          kind: "blocked",
          message: describeActionFailure(deniedStep.action, deniedStep.action.risk === "high" ? "high_risk" : "unsupported")
        };
      }

      if (actionSteps.length > 1) {
        return {
          kind: "pending_actions",
          message: plan.replyDraft,
          actions: actionSteps.map((step) => step.action)
        };
      }

      const [actionStep] = actionSteps;
      return {
        kind: "pending_action",
        message: plan.replyDraft,
        action: actionStep.action
      };
    }
  };
}
