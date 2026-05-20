import type { ChatPayload } from "./chatPayload";

export type PanelName = "chat" | "reminders" | "memory" | "settings";

export type PendingActionDto = {
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

export type AikoApi = {
  ping: () => Promise<{ ok: true; value: "pong" }>;
  setClickThrough: (enabled: boolean) => Promise<void>;
  openPanel: (panel: PanelName) => Promise<void>;
  sendMessage: (payload: ChatPayload) => Promise<ChatResponse>;
  executeAction: (request: ExecuteActionRequest) => Promise<ExecuteActionResponse>;
};

declare global {
  interface Window {
    aiko: AikoApi;
  }
}

export {};
