export type RiskLevel = "low" | "medium" | "high";

export type CapabilityRequest = {
  capability: string;
  target: string;
  risk: RiskLevel;
};

export type CapabilityDecision =
  | { allowed: true; reason: "remembered" | "confirmed_once" }
  | { allowed: false; reason: "confirmation_required" | "unsupported_high_risk" };
