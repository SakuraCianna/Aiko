import type { ChatPayload } from "./chatPayload";

export type PanelName = "chat" | "reminders" | "memory" | "settings";

export type PendingActionDto = {
  id?: string;
  title: string;
  source: string;
  risk: "low" | "medium" | "high";
  capability: string;
  target: string;
  params?: Record<string, string | number | boolean>;
};

export type ExecuteActionRequest = {
  action: PendingActionDto;
  remember: boolean;
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

export type WindowDragPoint = {
  screenX: number;
  screenY: number;
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

export type AikoApi = {
  ping: () => Promise<{ ok: true; value: "pong" }>;
  setClickThrough: (enabled: boolean) => Promise<void>;
  getCursorState: () => Promise<CursorState>;
  startWindowDrag: (point: WindowDragPoint) => Promise<void>;
  moveWindowDrag: (point: WindowDragPoint) => Promise<void>;
  endWindowDrag: () => Promise<void>;
  openPanel: (panel: PanelName) => Promise<void>;
  sendMessage: (payload: ChatPayload) => Promise<ChatResponse>;
  streamMessage: (requestId: string, payload: ChatPayload) => Promise<ChatResponse>;
  onChatStreamDelta: (listener: (delta: ChatStreamDelta) => void) => () => void;
  executeAction: (request: ExecuteActionRequest) => Promise<ExecuteActionResponse>;
  listMemory: () => Promise<MemorySnapshotDto>;
  acceptMemoryCandidate: (candidateId: string) => Promise<{ ok: boolean; message: string }>;
  rejectMemoryCandidate: (candidateId: string) => Promise<{ ok: boolean; message: string }>;
};

declare global {
  interface Window {
    aiko: AikoApi;
  }
}

export {};
