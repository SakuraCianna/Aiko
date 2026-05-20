import type { CapabilityDecision, CapabilityRequest } from "../capabilities/capabilityTypes";

export type PermissionRule = {
  capability: string;
  target: string;
  risk: "low" | "medium" | "high";
};

export function createPermissionService(initialRules: PermissionRule[]) {
  const rules = new Map<string, PermissionRule>();
  for (const rule of initialRules) {
    rules.set(ruleKey(rule), rule);
  }

  return {
    canExecute(request: CapabilityRequest): CapabilityDecision {
      if (request.risk === "high") {
        return { allowed: false, reason: "unsupported_high_risk" };
      }

      if (rules.has(ruleKey(request))) {
        return { allowed: true, reason: "remembered" };
      }

      return { allowed: false, reason: "confirmation_required" };
    },

    remember(request: CapabilityRequest) {
      if (request.risk === "high") return;
      rules.set(ruleKey(request), request);
    },

    list() {
      return Array.from(rules.values());
    }
  };
}

function ruleKey(rule: Pick<PermissionRule, "capability" | "target">): string {
  return `${rule.capability}:${rule.target.toLowerCase()}`;
}
