import type { AikoAgentStatusEventDto, AikoAgentStatusPhase } from "../../../shared/ipcTypes";
import type { AikoRuntimeHookEvent, AikoRuntimeHooks } from "./runtimeHooks";

type AgentStatusWindow = {
  isDestroyed?: () => boolean;
  webContents: {
    send: (channel: string, event: AikoAgentStatusEventDto) => void;
  };
};

const AGENT_STATUS_CHANNEL = "agent:status";

// 把 runtime hook 里的 Agent 状态转发给渲染层, 供 VRM 动作和调试 UI 使用.
export function attachAikoAgentStatusForwarder(windows: AgentStatusWindow[], hooks: Pick<AikoRuntimeHooks, "on">) {
  const unsubscribeStatus = hooks.on("agent_status", (event) => {
    const status = normalizeAgentStatusEvent(event);
    if (!status) return;
    sendAgentStatus(windows, status);
  });
  const unsubscribeBeforeTool = hooks.on("before_tool_call", (event) => {
    sendAgentStatus(windows, createToolStatusEvent(event));
  });

  return () => {
    unsubscribeStatus();
    unsubscribeBeforeTool();
  };
}

// 规范化 Agent 状态 payload, 避免 renderer 收到结构不稳定的数据.
function normalizeAgentStatusEvent(event: AikoRuntimeHookEvent): AikoAgentStatusEventDto | null {
  const payload = event.payload;
  if (!payload || typeof payload !== "object") return null;

  const record = payload as Record<string, unknown>;
  const phase = record.phase;
  const message = record.message;
  const createdAt = record.createdAt;
  if (!isAgentStatusPhase(phase) || typeof message !== "string" || typeof createdAt !== "string") return null;

  return {
    phase,
    message,
    createdAt,
    requestId: typeof record.requestId === "string" ? record.requestId : undefined,
    runId: event.runId,
    detail: normalizeStatusDetail(record.detail)
  };
}

// 把本地动作执行 hook 转换成同一套 Agent 状态事件.
function createToolStatusEvent(event: AikoRuntimeHookEvent): AikoAgentStatusEventDto {
  return {
    phase: "action_executing",
    message: "Aiko is executing a confirmed local action.",
    createdAt: new Date().toISOString(),
    runId: event.runId,
    detail: normalizeStatusDetail(event.payload)
  };
}

// 向所有仍然存活的窗口广播状态, 单个窗口失败不影响其它窗口.
function sendAgentStatus(windows: AgentStatusWindow[], status: AikoAgentStatusEventDto) {
  for (const win of windows) {
    if (win.isDestroyed?.()) continue;
    try {
      win.webContents.send(AGENT_STATUS_CHANNEL, status);
    } catch {
      continue;
    }
  }
}

// 限制 detail 只能包含可安全序列化的标量字段.
function normalizeStatusDetail(value: unknown): AikoAgentStatusEventDto["detail"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const detail: NonNullable<AikoAgentStatusEventDto["detail"]> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "string" || typeof item === "number" || typeof item === "boolean" || item === null) {
      detail[key] = item;
    }
  }
  return Object.keys(detail).length > 0 ? detail : undefined;
}

// 判断 hook payload 里的 phase 是否属于渲染层支持的状态集合.
function isAgentStatusPhase(value: unknown): value is AikoAgentStatusPhase {
  return (
    value === "accepted" ||
    value === "running" ||
    value === "retrieving" ||
    value === "planning" ||
    value === "preparing_action" ||
    value === "waiting_approval" ||
    value === "model_generating" ||
    value === "memory_writing" ||
    value === "action_executing" ||
    value === "completed" ||
    value === "failed" ||
    value === "cancelled"
  );
}
