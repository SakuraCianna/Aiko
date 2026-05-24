import type { PendingActionDto } from "../../../shared/ipcTypes";

export type AikoCapabilityPolicyDecisionName = "allow" | "confirm" | "deny";

export type AikoCapabilityPolicyRule = {
  capability: string;
  defaultDecision: AikoCapabilityPolicyDecisionName;
  risk: PendingActionDto["risk"];
  rememberable: boolean;
  batchAllowed: boolean;
  cooldownMs?: number;
  allowedTargets?: string[];
};

export type AikoCapabilityPolicy = {
  get: (capability: string) => AikoCapabilityPolicyRule | null;
  list: () => AikoCapabilityPolicyRule[];
};

export type AikoCapabilityPolicyDecision = {
  allowed: boolean;
  requiresConfirmation: boolean;
  rememberable: boolean;
  reason:
    | "allowed"
    | "confirmation_required"
    | "denied_by_policy"
    | "unknown_capability"
    | "target_denied"
    | "nested_batch_denied"
    | "high_risk_denied";
};

const DEFAULT_POLICY_RULES: AikoCapabilityPolicyRule[] = [
  {
    capability: "open_application",
    defaultDecision: "confirm",
    risk: "low",
    rememberable: true,
    batchAllowed: true
  },
  {
    capability: "open_url",
    defaultDecision: "confirm",
    risk: "low",
    rememberable: true,
    batchAllowed: true
  },
  {
    capability: "create_reminder",
    defaultDecision: "confirm",
    risk: "low",
    rememberable: false,
    batchAllowed: true
  },
  {
    capability: "cancel_reminder",
    defaultDecision: "confirm",
    risk: "low",
    rememberable: false,
    batchAllowed: true
  },
  {
    capability: "set_default_application",
    defaultDecision: "confirm",
    risk: "low",
    rememberable: true,
    batchAllowed: true
  },
  {
    capability: "write_desktop_markdown",
    defaultDecision: "confirm",
    risk: "medium",
    rememberable: false,
    batchAllowed: true,
    allowedTargets: ["Desktop/Aiko"]
  },
  {
    capability: "batch_actions",
    defaultDecision: "confirm",
    risk: "medium",
    rememberable: false,
    batchAllowed: false
  }
];

// 创建默认能力策略矩阵, 将工具安全规则从执行器中解耦出来.
export function createDefaultCapabilityPolicy(rules: AikoCapabilityPolicyRule[] = DEFAULT_POLICY_RULES): AikoCapabilityPolicy {
  const cloned = rules.map(clonePolicyRule);
  const byCapability = new Map(cloned.map((rule) => [rule.capability, rule]));

  return {
    // 按能力名读取策略规则.
    get(capability) {
      const rule = byCapability.get(capability);
      return rule ? clonePolicyRule(rule) : null;
    },

    // 列出全部策略规则.
    list() {
      return cloned.map(clonePolicyRule);
    }
  };
}

// 根据策略矩阵判断一个待执行动作是否允许进入审批或执行链路.
export function evaluateCapabilityPolicy(
  action: PendingActionDto,
  policy: AikoCapabilityPolicy = createDefaultCapabilityPolicy()
): AikoCapabilityPolicyDecision {
  if (action.capability === "batch_actions") {
    return evaluateBatchPolicy(action, policy);
  }

  return evaluateSingleAction(action, policy);
}

// 检查单个动作的能力, 风险和目标约束.
function evaluateSingleAction(action: PendingActionDto, policy: AikoCapabilityPolicy): AikoCapabilityPolicyDecision {
  const rule = policy.get(action.capability);
  if (!rule) return denied("unknown_capability");
  if (action.risk === "high") return denied("high_risk_denied");
  if (rule.defaultDecision === "deny") return denied("denied_by_policy");
  if (rule.allowedTargets && !rule.allowedTargets.includes(action.target)) return denied("target_denied");

  return {
    allowed: true,
    requiresConfirmation: rule.defaultDecision === "confirm",
    rememberable: rule.rememberable && action.risk === "low",
    reason: rule.defaultDecision === "confirm" ? "confirmation_required" : "allowed"
  };
}

// 检查批量动作, 拒绝嵌套批量和不允许批处理的子能力.
function evaluateBatchPolicy(action: PendingActionDto, policy: AikoCapabilityPolicy): AikoCapabilityPolicyDecision {
  const batchRule = policy.get("batch_actions");
  if (!batchRule) return denied("unknown_capability");
  if (action.actions?.some((child) => child.capability === "batch_actions")) return denied("nested_batch_denied");

  for (const child of action.actions ?? []) {
    const childRule = policy.get(child.capability);
    if (!childRule) return denied("unknown_capability");
    if (!childRule.batchAllowed) return denied("denied_by_policy");
    const childDecision = evaluateSingleAction(child, policy);
    if (!childDecision.allowed) return childDecision;
  }

  return {
    allowed: true,
    requiresConfirmation: true,
    rememberable: false,
    reason: "confirmation_required"
  };
}

// 生成统一的拒绝结果.
function denied(reason: AikoCapabilityPolicyDecision["reason"]): AikoCapabilityPolicyDecision {
  return {
    allowed: false,
    requiresConfirmation: false,
    rememberable: false,
    reason
  };
}

// 克隆策略规则, 避免外部修改默认矩阵.
function clonePolicyRule(rule: AikoCapabilityPolicyRule): AikoCapabilityPolicyRule {
  return {
    ...rule,
    allowedTargets: rule.allowedTargets ? [...rule.allowedTargets] : undefined
  };
}
