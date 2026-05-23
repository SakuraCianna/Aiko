export type RiskLevel = "low" | "medium" | "high";

export type CapabilityName =
  | "open_application"
  | "open_url"
  | "open_configured_path"
  | "create_reminder"
  | "cancel_reminder"
  | "shell_command";

export type CapabilityRequest = {
  capability: CapabilityName;
  target: string;
  risk: RiskLevel;
};

export type CapabilityDecision =
  | { allowed: true; reason: "remembered" | "confirmed_once" }
  | { allowed: false; reason: "confirmation_required" | "unsupported_high_risk" };
