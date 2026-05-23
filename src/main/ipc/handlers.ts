import { BrowserWindow, ipcMain, screen, type WebContents } from "electron";
import { resolveOpenApplicationAction } from "../actions/applicationActionPolicy";
import { createActionExecutor } from "../actions/actionExecutor";
import { isConversationResetRequest, type AikoAgentRuntime } from "../agent/aikoAgentRuntime";
import { discoverApplications } from "../capabilities/applicationCatalog";
import { openApplication, type ApplicationConfig } from "../capabilities/openApplication";
import { openUrl } from "../capabilities/openUrl";
import { createDesktopMarkdownWriter } from "../capabilities/writeDesktopMarkdown";
import type {
  ApplicationPreferenceRepository,
  MemoryRepository,
  PermissionRepository,
  ReminderRepository
} from "../database/repositories";
import { validateChatPayload, type ChatPayload } from "../../shared/chatPayload";
import type { ChatResponse, ExecuteActionRequest, PanelName, PendingActionDto, ReminderStatusDto } from "../../shared/ipcTypes";

export type AikoHandlerDeps = {
  agentRuntime: AikoAgentRuntime;
  petWindow: BrowserWindow;
  panelWindow: BrowserWindow;
  memoryRepository?: Pick<MemoryRepository, "listMemories" | "listPendingCandidates" | "acceptCandidate" | "rejectCandidate">;
  permissionRepository?: Pick<PermissionRepository, "remember" | "has" | "list">;
  reminderRepository?: Pick<ReminderRepository, "save" | "list" | "updateStatus" | "delete" | "cancelLatestActive">;
  applicationPreferenceRepository?: Pick<ApplicationPreferenceRepository, "setDefaultApplication" | "getDefaultApplication">;
  applicationProvider?: () => ApplicationConfig[];
};

type PendingActionEntry = {
  action: PendingActionDto;
  createdAt: number;
};

const PENDING_ACTION_TTL_MS = 10 * 60 * 1000;

// 注册主进程 IPC 处理器, 连接窗口, Agent, 记忆和本地动作执行.
export function registerAikoHandlers(deps: AikoHandlerDeps) {
  const pendingActions = new Map<string, PendingActionEntry>();
  const getApplications = deps.applicationProvider ?? (() => discoverApplications());
  const writeDesktopMarkdown = createDesktopMarkdownWriter();
  const actionExecutor = createActionExecutor({
    openUrl,
    openApplication: (query) => openApplication(getApplications(), query),
    writeDesktopMarkdown,
    now: () => new Date(),
    applicationPreferenceRepository: deps.applicationPreferenceRepository,
    permissionRepository: deps.permissionRepository,
    reminderRepository: deps.reminderRepository
  });

  ipcMain.handle("aiko:ping", () => ({ ok: true, value: "pong" as const }));

  ipcMain.handle("window:set-click-through", (_event, enabled: unknown) => {
    if (typeof enabled !== "boolean") return;
    deps.petWindow.setIgnoreMouseEvents(enabled, { forward: true });
  });

  ipcMain.handle("window:get-cursor-state", () => {
    const cursor = screen.getCursorScreenPoint();
    const bounds = deps.petWindow.getBounds();
    return {
      screenX: cursor.x,
      screenY: cursor.y,
      windowX: bounds.x,
      windowY: bounds.y,
      windowWidth: bounds.width,
      windowHeight: bounds.height
    };
  });

  ipcMain.handle("window:open-panel", (_event, panel: unknown) => {
    if (!isPanelName(panel)) return;
    deps.panelWindow.show();
    deps.panelWindow.webContents.send("panel:set-active", panel);
  });

  ipcMain.handle("chat:send-message", async (_event, input: unknown): Promise<ChatResponse> => {
    const payload = parseChatPayload(input);
    if (!payload) {
      return { message: "这个输入暂时不能处理,可能是附件格式或大小不符合要求." };
    }
    if (isConversationResetRequest(payload)) pendingActions.clear();

    try {
      const response = await deps.agentRuntime.respond(payload);
      return respondWithLocalAction(response.message, response.pendingAction);
    } catch {
      return { message: "我这边暂时没有收到回复,但本地功能还在." };
    }
  });

  ipcMain.handle("chat:stream-message", async (event, requestId: unknown, input: unknown): Promise<ChatResponse> => {
    if (typeof requestId !== "string" || requestId.length === 0) {
      return { message: "这个流式请求缺少有效 ID." };
    }

    const payload = parseChatPayload(input);
    if (!payload) {
      return { message: "这个输入暂时不能处理,可能是附件格式或大小不符合要求." };
    }
    if (isConversationResetRequest(payload)) pendingActions.clear();

    try {
      const response = await deps.agentRuntime.respondStream(payload, (text) => {
        sendStreamDelta(event.sender, requestId, text);
      });
      return respondWithLocalAction(response.message, response.pendingAction);
    } catch {
      return { message: "我这边暂时没有收到回复,但本地功能还在." };
    }
  });

  ipcMain.handle("action:execute", async (_event, request: unknown) => {
    if (!isExecuteActionRequest(request)) {
      return { ok: false, message: "这个操作请求格式不正确." };
    }

    const actionId = request.action.id;
    if (!actionId) {
      return { ok: false, message: "这个操作没有有效的确认令牌." };
    }

    removeExpiredPendingActions(pendingActions, Date.now());
    const pendingEntry = pendingActions.get(actionId);
    pendingActions.delete(actionId);
    if (!pendingEntry || !sameAction(pendingEntry.action, request.action)) {
      return { ok: false, message: "这个操作已过期或被修改,请重新发起." };
    }

    return actionExecutor.execute({ action: pendingEntry.action, remember: request.remember });
  });

  ipcMain.handle("conversation:list", () => {
    return deps.agentRuntime.listConversation();
  });

  ipcMain.handle("conversation:reset", () => {
    pendingActions.clear();
    return deps.agentRuntime.resetConversation();
  });

  ipcMain.handle("memory:list", () => {
    return {
      memories: deps.memoryRepository?.listMemories() ?? [],
      pendingCandidates: deps.memoryRepository?.listPendingCandidates() ?? []
    };
  });

  ipcMain.handle("memory:accept-candidate", (_event, candidateId: unknown) => {
    if (typeof candidateId !== "string" || !deps.memoryRepository) {
      return { ok: false, message: "记忆候选不存在." };
    }
    const ok = deps.memoryRepository.acceptCandidate(candidateId);
    return ok ? { ok: true, message: "已加入长期记忆." } : { ok: false, message: "记忆候选不存在." };
  });

  ipcMain.handle("memory:reject-candidate", (_event, candidateId: unknown) => {
    if (typeof candidateId !== "string" || !deps.memoryRepository) {
      return { ok: false, message: "记忆候选不存在." };
    }
    const ok = deps.memoryRepository.rejectCandidate(candidateId);
    return ok ? { ok: true, message: "已忽略这条记忆." } : { ok: false, message: "记忆候选不存在." };
  });

  ipcMain.handle("reminder:list", () => {
    return {
      reminders: deps.reminderRepository?.list() ?? actionExecutor.listReminders()
    };
  });

  ipcMain.handle("reminder:update-status", (_event, reminderId: unknown, status: unknown) => {
    if (typeof reminderId !== "string" || !isReminderStatus(status) || !deps.reminderRepository) {
      return { ok: false, message: "提醒不存在或状态无效." };
    }

    const ok = deps.reminderRepository.updateStatus(reminderId, status);
    if (!ok) return { ok: false, message: "提醒不存在." };
    return { ok: true, message: describeReminderStatusUpdate(status) };
  });

  ipcMain.handle("reminder:delete", (_event, reminderId: unknown) => {
    if (typeof reminderId !== "string" || !deps.reminderRepository) {
      return { ok: false, message: "提醒不存在." };
    }

    const ok = deps.reminderRepository.delete(reminderId);
    return ok ? { ok: true, message: "提醒已删除." } : { ok: false, message: "提醒不存在." };
  });

  // 根据权限状态决定是直接执行动作还是返回待确认动作.
  async function respondWithLocalAction(
    message: string,
    action: PendingActionDto | undefined
  ): Promise<ChatResponse> {
    if (!action) return { message };

    if (!isSupportedAction(action)) return { message };

    if (action.capability === "open_application") {
      const decision = resolveOpenApplicationAction(action, getApplications(), {
        defaultApplicationTarget: deps.applicationPreferenceRepository?.getDefaultApplication(action.target)
      });
      if (decision.kind === "choice_required") {
        return createApplicationChoiceResponse(decision.message, action, decision.actions);
      }

      if (actionExecutor.isRememberedAction(decision.action)) {
        const result = await actionExecutor.execute({ action: decision.action, remember: false });
        return { message: result.message };
      }

      return { message, pendingAction: storePendingAction(decision.action) };
    }

    if (actionExecutor.isRememberedAction(action)) {
      const result = await actionExecutor.execute({ action, remember: false });
      return { message: result.message };
    }

    const pendingAction = storePendingAction(action);
    return { message, pendingAction };
  }

  // 为候选应用生成独立待执行动作, 用户选择某一项时只执行对应动作.
  function createApplicationChoiceResponse(
    message: string,
    sourceAction: PendingActionDto,
    actions: PendingActionDto[]
  ): ChatResponse {
    const choices = actions.map((candidate) => {
      const pendingChoice = storePendingAction(candidate);
      return {
        id: pendingChoice.id,
        title: pendingChoice.target,
        subtitle: "打开这个应用",
        action: {
          id: pendingChoice.id,
          title: pendingChoice.title,
          source: pendingChoice.source,
          risk: pendingChoice.risk,
          capability: pendingChoice.capability,
          target: pendingChoice.target,
          params: pendingChoice.params
        }
      };
    });

    return {
      message,
      pendingAction: {
        id: crypto.randomUUID(),
        title: "选择要打开的应用",
        source: sourceAction.source,
        risk: "low",
        capability: "choose_application",
        target: sourceAction.target,
        choices
      }
    };
  }

  // 保存一个待确认动作并分配一次性确认令牌.
  function storePendingAction(action: PendingActionDto): PendingActionDto & { id: string } {
    const actionId = crypto.randomUUID();
    const pendingAction = { ...action, id: actionId };
    removeExpiredPendingActions(pendingActions, Date.now());
    pendingActions.set(actionId, { action: pendingAction, createdAt: Date.now() });
    return pendingAction;
  }
}

// 校验聊天输入, 无效时返回 null 供 IPC 层降级处理.
// 清理已经过期的待确认动作, 避免很久之前的授权被重新执行.
function removeExpiredPendingActions(pendingActions: Map<string, PendingActionEntry>, now: number) {
  for (const [actionId, entry] of pendingActions) {
    if (now - entry.createdAt > PENDING_ACTION_TTL_MS) {
      pendingActions.delete(actionId);
    }
  }
}

// 校验聊天输入, 无效时返回 null 供 IPC 层降级处理.
function parseChatPayload(input: unknown): ChatPayload | null {
  try {
    return validateChatPayload(input);
  } catch {
    return null;
  }
}

// 发送流式增量前检查 WebContents 生命周期, 避免窗口关闭后继续投递 IPC.
function sendStreamDelta(sender: WebContents, requestId: string, text: string) {
  if (sender.isDestroyed()) return;
  try {
    sender.send("chat:stream-delta", { requestId, text });
  } catch {
    return;
  }
}

// 判断传入值是否是受支持的面板名称.
function isPanelName(value: unknown): value is PanelName {
  return value === "chat" || value === "reminders" || value === "memory" || value === "settings";
}

// 校验执行动作请求的基本结构和动作内容.
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

// 判断待执行动作是否在当前版本支持的安全范围内.
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

  if (action.capability === "cancel_reminder") {
    const params = action.params;
    const target = typeof params?.target === "string" ? params.target : action.target;
    return action.target === "latest" && target === "latest";
  }

  if (action.capability === "set_default_application") {
    const params = action.params;
    return (
      !!params &&
      typeof params.defaultFor === "string" &&
      params.defaultFor.trim().length > 0 &&
      params.defaultFor.length <= 180 &&
      typeof params.application === "string" &&
      params.application.trim().length > 0 &&
      params.application.length <= 180
    );
  }

  if (action.capability === "write_desktop_markdown") {
    const params = action.params;
    return (
      action.target === "Desktop/Aiko" &&
      !!params &&
      typeof params.title === "string" &&
      params.title.trim().length > 0 &&
      params.title.length <= 120 &&
      typeof params.content === "string" &&
      params.content.trim().length > 0 &&
      params.content.length <= 200000
    );
  }

  return false;
}

// 判断提醒状态是否属于前端可修改的安全范围.
function isReminderStatus(value: unknown): value is ReminderStatusDto {
  return value === "active" || value === "paused" || value === "completed" || value === "cancelled";
}

// 根据提醒状态生成面板操作反馈.
function describeReminderStatusUpdate(status: ReminderStatusDto): string {
  if (status === "active") return "提醒已恢复.";
  if (status === "paused") return "提醒已暂停.";
  if (status === "completed") return "提醒已标记完成.";
  return "提醒已取消.";
}

// 比较确认时的动作是否和原始待确认动作完全一致.
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
