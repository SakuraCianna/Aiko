import type { ChatPayload } from "./chatPayload";

export type PanelName = "chat" | "reminders" | "memory" | "agent" | "audit" | "settings";

export type PendingActionApprovalDto = {
  mode: "passive" | "interrupt";
  threadId?: string;
  status: "pending_action" | "reviewed";
  workflow?: "agent" | "action_approval";
};

export type PendingActionBaseDto = {
  id?: string;
  title: string;
  source: string;
  risk: "low" | "medium" | "high";
  capability: string;
  target: string;
  params?: Record<string, string | number | boolean>;
  approval?: PendingActionApprovalDto;
};

export type PendingActionChoiceDto = {
  id: string;
  title: string;
  subtitle?: string;
  action: PendingActionDto & { id: string };
};

export type PendingActionDto = PendingActionBaseDto & {
  choices?: PendingActionChoiceDto[];
  actions?: PendingActionDto[];
};

export type ExecuteActionRequest = {
  action: PendingActionDto;
  remember: boolean;
};

export type CancelActionRequest = {
  action: PendingActionDto;
  reason?: string;
};

export type ExecuteActionResponse = {
  ok: boolean;
  message: string;
};

export type ChatResponse = {
  message: string;
  pendingAction?: PendingActionDto;
};

export type ChatStreamDelta = {
  requestId: string;
  text: string;
};

export type SynthesizeSpeechRequestDto = {
  text: string;
  emotion?: "neutral" | "happy" | "serious" | "comfort" | "notice";
  voiceProfileId?: string;
  speed?: number;
};

export type SynthesizeSpeechResponseDto =
  | {
      ok: true;
      dataUrl: string;
      mimeType: string;
    }
  | {
      ok: false;
      message: string;
    };

export type VoiceProviderStatusDto = {
  provider: "tencent-cloud";
  status: "disabled" | "ready" | "unreachable";
  baseUrl: string;
  message: string;
};

export type VoiceStatusSnapshotDto = {
  asr: VoiceProviderStatusDto;
  tts: VoiceProviderStatusDto;
};

export type AikoAgentStatusPhase =
  | "accepted"
  | "running"
  | "retrieving"
  | "planning"
  | "preparing_action"
  | "waiting_approval"
  | "model_generating"
  | "memory_writing"
  | "action_executing"
  | "completed"
  | "failed"
  | "cancelled";

export type AikoAgentStatusEventDto = {
  phase: AikoAgentStatusPhase;
  message: string;
  createdAt: string;
  requestId?: string;
  runId?: string;
  detail?: Record<string, string | number | boolean | null>;
};

export type AikoProactiveMessage = {
  id: string;
  kind: "commitment" | "companion_checkin";
  message: string;
  commitmentId?: string;
  createdAt: string;
  shouldSpeak?: boolean;
  tone?: "gentle" | "notice" | "curious";
};

export type CursorState = {
  screenX: number;
  screenY: number;
  windowX: number;
  windowY: number;
  windowWidth: number;
  windowHeight: number;
};

export type MemoryCandidateDto = {
  id: string;
  type: string;
  content: string;
  confidence: number;
  requiresConfirmation: boolean;
  status: string;
  createdAt: string;
};

export type MemoryItemDto = {
  id: string;
  type: string;
  content: string;
  confidence: number;
  status: string;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
};

export type MemorySnapshotDto = {
  memories: MemoryItemDto[];
  pendingCandidates: MemoryCandidateDto[];
};

export type ReminderStatusDto = "active" | "paused" | "completed" | "cancelled";

export type ReminderItemDto = {
  id: string;
  title: string;
  triggerAt: string;
  createdAt: string;
  status: ReminderStatusDto;
};

export type ReminderSnapshotDto = {
  reminders: ReminderItemDto[];
};

export type ConversationMessageDto = {
  role: "user" | "assistant";
  content: string;
  createdAt: string;
};

export type ConversationSnapshotDto = {
  messages: ConversationMessageDto[];
  maxMessages: number;
  maxContextChars: number;
};

export type AikoRunStatusDto = "accepted" | "running" | "waiting_approval" | "completed" | "failed" | "cancelled";

export type AikoRunRecordDto = {
  id: string;
  sessionId: string;
  status: AikoRunStatusDto;
  userText: string;
  createdAt: string;
  updatedAt: string;
  summary?: string;
  error?: string;
};

export type AikoActionJournalEntryDto = {
  id: string;
  phase: "planned" | "approval" | "execution";
  actionId: string;
  runId?: string;
  capability: string;
  target: string;
  risk: "low" | "medium" | "high";
  source?: string;
  decision?: "approved" | "rejected" | "cancelled";
  ok?: boolean;
  message?: string;
  createdAt: string;
};

export type AikoTraceEventDto = {
  name: string;
  at: string;
  data?: Record<string, unknown>;
};

export type AikoTraceRecordDto = {
  requestId: string;
  startedAt: string;
  endedAt: string | null;
  events: AikoTraceEventDto[];
};

export type AikoWorkerSummaryDto = {
  name: string;
  description: string;
};

export type AikoWorkerRunDto = {
  id: string;
  workerName: string;
  status: "running" | "completed" | "failed";
  inputSummary: string;
  outputSummary?: string;
  error?: string;
  startedAt: string;
  endedAt?: string;
};

export type AikoExperienceSignalDto = {
  id: string;
  tone: "positive" | "negative" | "corrective" | "neutral";
  satisfaction: "satisfied" | "unsatisfied" | "unclear";
  aspect: "answer_style" | "tool_behavior" | "memory_behavior" | "latency" | "general";
  confidence: number;
  summary: string;
  recommendation: string;
  sourceText: string;
  createdAt: string;
};

export type AikoAgentDebugSnapshotDto = {
  runs: AikoRunRecordDto[];
  statuses: AikoAgentStatusEventDto[];
  experienceSignals: AikoExperienceSignalDto[];
  actionJournal: AikoActionJournalEntryDto[];
  traces: AikoTraceRecordDto[];
  workers: AikoWorkerSummaryDto[];
  workerRuns: AikoWorkerRunDto[];
};

export type AikoApi = {
  ping: () => Promise<{ ok: true; value: "pong" }>;
  setClickThrough: (enabled: boolean) => Promise<void>;
  getCursorState: () => Promise<CursorState>;
  openPanel: (panel: PanelName) => Promise<void>;
  sendMessage: (payload: ChatPayload) => Promise<ChatResponse>;
  streamMessage: (requestId: string, payload: ChatPayload) => Promise<ChatResponse>;
  cancelStream: (requestId: string) => Promise<{ ok: boolean; message: string }>;
  synthesizeSpeech: (request: SynthesizeSpeechRequestDto) => Promise<SynthesizeSpeechResponseDto>;
  getVoiceStatus: () => Promise<VoiceStatusSnapshotDto>;
  onChatStreamDelta: (listener: (delta: ChatStreamDelta) => void) => () => void;
  onAgentStatus: (listener: (event: AikoAgentStatusEventDto) => void) => () => void;
  onProactiveMessage: (listener: (message: AikoProactiveMessage) => void) => () => void;
  executeAction: (request: ExecuteActionRequest) => Promise<ExecuteActionResponse>;
  cancelAction: (request: CancelActionRequest) => Promise<ExecuteActionResponse>;
  listConversation: () => Promise<ConversationSnapshotDto>;
  resetConversation: () => Promise<ConversationSnapshotDto>;
  getAgentDebugSnapshot: () => Promise<AikoAgentDebugSnapshotDto>;
  listMemory: () => Promise<MemorySnapshotDto>;
  acceptMemoryCandidate: (candidateId: string) => Promise<{ ok: boolean; message: string }>;
  rejectMemoryCandidate: (candidateId: string) => Promise<{ ok: boolean; message: string }>;
  listReminders: () => Promise<ReminderSnapshotDto>;
  updateReminderStatus: (reminderId: string, status: ReminderStatusDto) => Promise<{ ok: boolean; message: string }>;
  deleteReminder: (reminderId: string) => Promise<{ ok: boolean; message: string }>;
};

declare global {
  interface Window {
    aiko: AikoApi;
  }
}

export {};
