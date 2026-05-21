import { BrowserWindow, ipcMain } from "electron";
import { createActionExecutor } from "../actions/actionExecutor";
import type { AikoAgentRuntime } from "../agent/aikoAgentRuntime";
import { discoverApplications } from "../capabilities/applicationCatalog";
import { openApplication } from "../capabilities/openApplication";
import { openUrl } from "../capabilities/openUrl";
import type { MemoryRepository, PermissionRepository, ReminderRepository } from "../database/repositories";
import { validateChatPayload, type ChatPayload } from "../../shared/chatPayload";
import type { ChatResponse, ExecuteActionRequest, PanelName, PendingActionDto } from "../../shared/ipcTypes";

export type AikoHandlerDeps = {
  agentRuntime: AikoAgentRuntime;
  petWindow: BrowserWindow;
  panelWindow: BrowserWindow;
  memoryRepository?: Pick<MemoryRepository, "listMemories" | "listPendingCandidates" | "acceptCandidate" | "rejectCandidate">;
  permissionRepository?: Pick<PermissionRepository, "remember" | "has" | "list">;
  reminderRepository?: Pick<ReminderRepository, "save" | "list">;
};

export function registerAikoHandlers(deps: AikoHandlerDeps) {
  const pendingActions = new Map<string, PendingActionDto>();
  const actionExecutor = createActionExecutor({
    openUrl,
    openApplication: (query) => openApplication(discoverApplications(), query),
    now: () => new Date(),
    permissionRepository: deps.permissionRepository,
    reminderRepository: deps.reminderRepository
  });

  ipcMain.handle("aiko:ping", () => ({ ok: true, value: "pong" as const }));

  ipcMain.handle("window:set-click-through", (_event, enabled: unknown) => {
    if (typeof enabled !== "boolean") return;
    deps.petWindow.setIgnoreMouseEvents(enabled, { forward: true });
  });

  ipcMain.handle("window:open-panel", (_event, panel: unknown) => {
    if (!isPanelName(panel)) return;
    deps.panelWindow.show();
    deps.panelWindow.webContents.send("panel:set-active", panel);
  });

  ipcMain.handle("chat:send-message", async (_event, input: unknown): Promise<ChatResponse> => {
    const payload = parseChatPayload(input);
    if (!payload) {
      return { message: "这个输入暂时不能处理，可能是附件格式或大小不符合要求。" };
    }

    try {
      const response = await deps.agentRuntime.respond(payload);
      return respondWithLocalAction(response.message, response.pendingAction);
    } catch {
      return {
        message: "我这边暂时没有收到回复，但本地功能还在。"
      };
    }
  });

  ipcMain.handle("chat:stream-message", async (event, requestId: unknown, input: unknown): Promise<ChatResponse> => {
    if (typeof requestId !== "string" || requestId.length === 0) {
      return { message: "这个流式请求缺少有效 ID。" };
    }

    const payload = parseChatPayload(input);
    if (!payload) {
      return { message: "这个输入暂时不能处理，可能是附件格式或大小不符合要求。" };
    }

    try {
      const response = await deps.agentRuntime.respondStream(payload, (text) => {
        event.sender.send("chat:stream-delta", { requestId, text });
      });
      return respondWithLocalAction(response.message, response.pendingAction);
    } catch {
      return {
        message: "我这边暂时没有收到回复，但本地功能还在。"
      };
    }
  });

  ipcMain.handle("action:execute", async (_event, request: unknown) => {
    if (!isExecuteActionRequest(request)) {
      return { ok: false, message: "这个操作请求格式不正确。" };
    }

    const actionId = request.action.id;
    if (!actionId) {
      return { ok: false, message: "这个操作没有有效的确认令牌。" };
    }

    const pendingAction = pendingActions.get(actionId);
    pendingActions.delete(actionId);
    if (!pendingAction || !sameAction(pendingAction, request.action)) {
      return { ok: false, message: "这个操作已过期或被修改，请重新发起。" };
    }

    return actionExecutor.execute({ action: pendingAction, remember: request.remember });
  });

  ipcMain.handle("memory:list", () => {
    return {
      memories: deps.memoryRepository?.listMemories() ?? [],
      pendingCandidates: deps.memoryRepository?.listPendingCandidates() ?? []
    };
  });

  ipcMain.handle("memory:accept-candidate", (_event, candidateId: unknown) => {
    if (typeof candidateId !== "string" || !deps.memoryRepository) {
      return { ok: false, message: "记忆候选不存在。" };
    }
    const ok = deps.memoryRepository.acceptCandidate(candidateId);
    return ok ? { ok: true, message: "已加入长期记忆。" } : { ok: false, message: "记忆候选不存在。" };
  });

  ipcMain.handle("memory:reject-candidate", (_event, candidateId: unknown) => {
    if (typeof candidateId !== "string" || !deps.memoryRepository) {
      return { ok: false, message: "记忆候选不存在。" };
    }
    const ok = deps.memoryRepository.rejectCandidate(candidateId);
    return ok ? { ok: true, message: "已忽略这条记忆。" } : { ok: false, message: "记忆候选不存在。" };
  });

  async function respondWithLocalAction(
    message: string,
    action: PendingActionDto | undefined
  ): Promise<ChatResponse> {
    if (!action) return { message };

    if (actionExecutor.isRememberedAction(action)) {
      const result = await actionExecutor.execute({ action, remember: false });
      return { message: result.message };
    }

    const actionId = crypto.randomUUID();
    const pendingAction = { ...action, id: actionId };
    pendingActions.set(actionId, pendingAction);
    return { message, pendingAction };
  }
}

function parseChatPayload(input: unknown): ChatPayload | null {
  try {
    return validateChatPayload(input);
  } catch {
    return null;
  }
}

function isPanelName(value: unknown): value is PanelName {
  return value === "chat" || value === "reminders" || value === "memory" || value === "settings";
}

function isExecuteActionRequest(value: unknown): value is ExecuteActionRequest {
  if (!value || typeof value !== "object") return false;
  const request = value as ExecuteActionRequest;
  const action = request.action;
  if (
    typeof request.remember === "boolean" &&
    !!action &&
    typeof action === "object" &&
    (action.id === undefined || typeof action.id === "string") &&
    typeof action.title === "string" &&
    typeof action.source === "string" &&
    (action.risk === "low" || action.risk === "medium" || action.risk === "high") &&
    typeof action.capability === "string" &&
    typeof action.target === "string"
  ) {
    return isSupportedAction(action);
  }
  return false;
}

function isSupportedAction(action: PendingActionDto): boolean {
  if (action.title.length > 180 || action.source.length > 1000 || action.target.length > 2048) return false;

  if (action.capability === "open_url") {
    try {
      const url = new URL(action.target);
      return url.protocol === "http:" || url.protocol === "https:";
    } catch {
      return false;
    }
  }

  if (action.capability === "open_application") {
    return action.target.trim().length > 0 && action.target.length <= 180;
  }

  if (action.capability === "create_reminder") {
    const params = action.params;
    return (
      !!params &&
      typeof params.amount === "number" &&
      Number.isInteger(params.amount) &&
      params.amount > 0 &&
      params.amount <= 525600 &&
      (params.unit === "minutes" || params.unit === "hours") &&
      typeof params.title === "string" &&
      params.title.trim().length > 0 &&
      params.title.length <= 180
    );
  }

  return false;
}

function sameAction(left: PendingActionDto, right: PendingActionDto): boolean {
  return (
    left.id === right.id &&
    left.title === right.title &&
    left.source === right.source &&
    left.risk === right.risk &&
    left.capability === right.capability &&
    left.target === right.target &&
    JSON.stringify(left.params ?? {}) === JSON.stringify(right.params ?? {})
  );
}
