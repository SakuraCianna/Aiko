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
    if (rule.risk !== "low") continue;
    rules.set(ruleKey(rule), rule);
  }

  return {
    // 判断某个能力请求当前是否允许执行.
    canExecute(request: CapabilityRequest): CapabilityDecision {
      if (request.risk === "low" && rules.has(ruleKey(request))) {
        return { allowed: true, reason: "remembered" };
      }

      return { allowed: false, reason: "confirmation_required" };
    },

    // 只记住低风险能力请求, 中高风险动作每次都需要确认.
    remember(request: CapabilityRequest) {
      if (request.risk !== "low") return;
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
