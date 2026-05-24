import type { ChatPayload } from "../../shared/chatPayload";
import type { PendingActionDto } from "../../shared/ipcTypes";
import type { RecalledMemory } from "../memory/memoryRecall";
import type { MemoryCandidate, MemoryStatus } from "../memory/memoryTypes";
import type { SpeechUnderstandingResult } from "../voice/voiceTypes";
import type { CurrentKnowledgeContext } from "./knowledge/currentKnowledgeProvider";
import type { WebResearchContext } from "./retriever/webTypes";

export type AgentTextPart = { type: "text"; text: string };
export type AgentImagePart = { type: "image_url"; image_url: { url: string } };
export type AgentUserContent = string | Array<AgentTextPart | AgentImagePart>;

export type AttachmentSummary = {
  id: string;
  kind: ChatPayload["attachments"][number]["kind"];
  name: string;
  mimeType: string;
  size: number;
};

export type RetrievedContext = {
  userText: string;
  userTranscript: string;
  userContent: AgentUserContent;
  attachmentSummaries: AttachmentSummary[];
  memories: RecalledMemory[];
  speechResults: SpeechUnderstandingResult[];
  webResearch: WebResearchContext | null;
  currentKnowledge: CurrentKnowledgeContext | null;
  toolHints: ToolHint[];
};

export type ToolHint = {
  name: string;
  capability: string;
  risk: "low" | "medium" | "high" | "critical";
  requiresConfirmation: boolean;
};

export type RetrieverInput = ChatPayload;

export type AikoPlanStep = {
  kind: "action";
  source: "deterministic" | "llm";
  action: PendingActionDto;
};

export type GroundingNote = {
  source: string;
  note: string;
};

export type AikoPlan = {
  mode: "chat" | "action" | "clarify" | "mixed";
  replyDraft: string;
  steps: AikoPlanStep[];
  grounding: GroundingNote[];
};

export type PlannerInput = {
  userText: string;
  userTranscript: string;
  toolHints: ToolHint[];
};

export type ExecutionProposal =
  | {
      kind: "none";
      message: string;
    }
  | {
      kind: "pending_action";
      message: string;
      action: PendingActionDto;
    }
  | {
      kind: "pending_actions";
      message: string;
      actions: PendingActionDto[];
    }
  | {
      kind: "blocked";
      message: string;
    };

export type AikoMemoryRuntime = {
  recall: (query: string, limit?: number) => Promise<RecalledMemory[]> | RecalledMemory[];
  rememberCandidate: (candidate: MemoryCandidate, status: MemoryStatus) => Promise<unknown> | unknown;
};
