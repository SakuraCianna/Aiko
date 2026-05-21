import type { CapabilityDecision, CapabilityRequest } from "../capabilities/capabilityTypes";

export type PermissionRule = {
  capability: string;
  target: string;
  risk: "low" | "medium" | "high";
};

// 创建内存权限服务, 用于判断动作是否需要用户确认.
export function createPermissionService(initialRules: PermissionRule[]) {
  const rules = new Map<string, PermissionRule>();
  for (const rule of initialRules) {
    rules.set(ruleKey(rule), rule);
  }

  return {
    // 判断某个能力请求当前是否允许执行.
    canExecute(request: CapabilityRequest): CapabilityDecision {
      if (request.risk === "high") {
        return { allowed: false, reason: "unsupported_high_risk" };
      }

      if (rules.has(ruleKey(request))) {
        return { allowed: true, reason: "remembered" };
      }

      return { allowed: false, reason: "confirmation_required" };
    },

    // 记住一个非高风险能力请求.
    remember(request: CapabilityRequest) {
      if (request.risk === "high") return;
      rules.set(ruleKey(request), request);
    },

    // 列出当前已记住的权限规则.
    list() {
      return Array.from(rules.values());
    }
  };
}

// 生成权限规则的稳定 key.
function ruleKey(rule: Pick<PermissionRule, "capability" | "target">): string {
  return `${rule.capability}:${rule.target.toLowerCase()}`;
}
