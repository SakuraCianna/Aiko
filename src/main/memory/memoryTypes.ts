export type MemoryType =
  | "preference"
  | "relationship"
  | "habit"
  | "software"
  | "recent_event"
  | "reminder"
  | "permission"
  | "sensitive";

export type MemoryCandidate = {
  type: MemoryType;
  content: string;
  confidence: number;
  requiresConfirmation: boolean;
};

export type MemoryStatus = "accepted" | "pending_confirmation" | "rejected";
