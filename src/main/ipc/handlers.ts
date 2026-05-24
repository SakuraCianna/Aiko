import { BrowserWindow, ipcMain, screen, type WebContents } from "electron";
import { resolveOpenApplicationAction } from "../actions/applicationActionPolicy";
import { createActionExecutor } from "../actions/actionExecutor";
import { isConversationResetRequest, type AikoAgentRuntime } from "../agent/aikoAgentRuntime";
import { discoverApplications } from "../capabilities/applicationCatalog";
import { openApplication, type ApplicationConfig } from "../capabilities/openApplication";
import { openUrl } from "../capabilities/openUrl";
import { createDesktopMarkdownWriter } from "../capabilities/writeDesktopMarkdown";
import { isAutoExecutableDesktopMarkdownAction } from "./localActionPolicy";
import type {
  ApplicationPreferenceRepository,
  MemoryRepository,
  PermissionRepository,
  ReminderRepository
} from "../database/repositories";
import { validateChatPayload, type ChatPayload } from "../../shared/chatPayload";
import type {
  CancelActionRequest,
  ChatResponse,
  ExecuteActionRequest,
  PanelName,
  PendingActionDto,
  ReminderStatusDto
} from "../../shared/ipcTypes";

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
const MAX_BATCH_ACTIONS = 5;

// 注册主进程 IPC 处理器, 连接窗口, Agent, 记忆和本地动作执行.
export function registerAikoHandlers(deps: AikoHandlerDeps) {
  const pendingActions = new Map<string, PendingActionEntry>();
  const streamControllers = new Map<string, AbortController>();
  const getApplications = deps.applicationProvider ?? (() => discoverApplications());
  const writeDesktopMarkdown = createDesktopMarkdownWriter();
  const actionExecutor = createActionExecutor({
    openUrl,
    openApplication: (query, expectedPath) => openApplication(getApplications(), query, expectedPath),
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
    if (isConversationResetRequest(payload)) clearPendingActions();

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
    if (isConversationResetRequest(payload)) clearPendingActions();

    abortPreviousStreamController(requestId);
    const abortController = new AbortController();
    streamControllers.set(requestId, abortController);
    try {
      const response = await deps.agentRuntime.respondStream(payload, (text) => {
        if (abortController.signal.aborted) return;
        sendStreamDelta(event.sender, requestId, text);
      }, { signal: abortController.signal });
      return respondWithLocalAction(response.message, response.pendingAction);
    } catch {
      return { message: "我这边暂时没有收到回复,但本地功能还在." };
    } finally {
      if (streamControllers.get(requestId) === abortController) {
        streamControllers.delete(requestId);
      }
    }
  });

  ipcMain.handle("chat:cancel-stream", (_event, requestId: unknown) => {
    if (typeof requestId !== "string" || requestId.length === 0) {
      return { ok: false, message: "这个中止请求缺少有效 ID." };
    }

    const controller = streamControllers.get(requestId);
    if (!controller) {
      return { ok: false, message: "没有找到正在输出的回复." };
    }

    controller.abort();
    streamControllers.delete(requestId);
    return { ok: true, message: "已中止当前回复." };
  });

  ipcMain.handle("action:execute", async (_event, request: unknown) => {
    if (!isExecuteActionRequest(request)) {
      return { ok: false, message: "这个操作请求格式不正确." };
    }

    const actionId = request.action.id;
    if (!actionId) {
      return { ok: false, message: "这个操作没有有效的确认令牌." };
    }

    pruneExpiredPendingActions();
    const pendingEntry = pendingActions.get(actionId);
    pendingActions.delete(actionId);
    if (!pendingEntry || !sameAction(pendingEntry.action, request.action)) {
      return { ok: false, message: "这个操作已过期或被修改,请重新发起." };
    }

    discardPendingActionApprovals(removeSiblingPendingActions(pendingActions, pendingEntry.action));
    return executeApprovedAction(pendingEntry.action, request.remember);
  });

  ipcMain.handle("action:cancel", async (_event, request: unknown) => {
    if (!isCancelActionRequest(request)) {
      return { ok: false, message: "这个取消请求格式不正确." };
    }

    const actionId = request.action.id;
    if (!actionId) {
      return { ok: false, message: "这个操作没有有效的确认令牌." };
    }

    pruneExpiredPendingActions();
    const pendingEntry = pendingActions.get(actionId);
    pendingActions.delete(actionId);
    if (!pendingEntry || !sameAction(pendingEntry.action, request.action)) {
      return { ok: false, message: "这个操作已过期或被修改,请重新发起." };
    }

    discardPendingActionApprovals(removeSiblingPendingActions(pendingActions, pendingEntry.action));
    const approval = await deps.agentRuntime.resumePendingActionApproval(pendingEntry.action, {
      type: "reject",
      reason: request.reason ?? "user_cancelled"
    });
    if (!approval.ok) return approval;

    return { ok: true, message: "已取消. 我没有执行这个操作." };
  });

  ipcMain.handle("conversation:list", () => {
    return deps.agentRuntime.listConversation();
  });

  ipcMain.handle("conversation:reset", () => {
    clearPendingActions();
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

    if (isAutoExecutableDesktopMarkdownAction(action)) {
      const result = await executeApprovedAction(action, false);
      return { message: result.message };
    }

    if (action.capability === "batch_actions") {
      return respondWithBatchAction(message, action);
    }

    if (action.capability === "open_application") {
      const decision = resolveOpenApplicationAction(action, getApplications(), {
        defaultApplicationTarget: deps.applicationPreferenceRepository?.getDefaultApplication(action.target)
      });
      if (decision.kind === "choice_required") {
        return createApplicationChoiceResponse(decision.message, action, decision.actions);
      }

      if (actionExecutor.isRememberedAction(decision.action)) {
        const result = await executeApprovedAction(decision.action, false);
        return { message: result.message };
      }

      return { message, pendingAction: storePendingAction(decision.action) };
    }

    if (actionExecutor.isRememberedAction(action)) {
      const result = await executeApprovedAction(action, false);
      return { message: result.message };
    }

    const pendingAction = storePendingAction(action);
    return { message, pendingAction };
  }

  // 批量动作在进入确认框前先逐项解析本地应用, 遇到歧义时把候选包装回整组动作.
  function respondWithBatchAction(message: string, action: PendingActionDto): ChatResponse {
    const resolvedActions: PendingActionDto[] = [];

    for (const [index, childAction] of (action.actions ?? []).entries()) {
      if (childAction.capability !== "open_application") {
        resolvedActions.push(childAction);
        continue;
      }

      const decision = resolveOpenApplicationAction(childAction, getApplications(), {
        defaultApplicationTarget: deps.applicationPreferenceRepository?.getDefaultApplication(childAction.target)
      });
      if (decision.kind === "choice_required") {
        return createBatchApplicationChoiceResponse(decision.message, action, index, decision.actions);
      }
      resolvedActions.push(decision.action);
    }

    const resolvedBatchAction: PendingActionDto = {
      ...action,
      actions: resolvedActions
    };
    return { message, pendingAction: storePendingAction(resolvedBatchAction) };
  }

  // 为候选应用生成独立待执行动作, 用户选择某一项时只执行对应动作.
  function createApplicationChoiceResponse(
    message: string,
    sourceAction: PendingActionDto,
    actions: PendingActionDto[]
  ): ChatResponse {
    const choices = actions.map((candidate) => {
      const actionWithApproval = sourceAction.approval ? { ...candidate, approval: sourceAction.approval } : candidate;
      const pendingChoice = storePendingAction(actionWithApproval);
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
          params: pendingChoice.params,
          approval: pendingChoice.approval
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

  // 为批量动作中的某个歧义应用生成候选, 用户选择后继续执行完整批量动作.
  function createBatchApplicationChoiceResponse(
    message: string,
    sourceAction: PendingActionDto,
    actionIndex: number,
    actions: PendingActionDto[]
  ): ChatResponse {
    const choices = actions.map((candidate) => {
      const batchActions = [...(sourceAction.actions ?? [])];
      batchActions[actionIndex] = candidate;
      const pendingBatch = storePendingAction({
        ...sourceAction,
        actions: batchActions
      });
      return {
        id: pendingBatch.id,
        title: candidate.target,
        subtitle: "打开这个应用, 并继续执行整组操作",
        action: {
          id: pendingBatch.id,
          title: pendingBatch.title,
          source: pendingBatch.source,
          risk: pendingBatch.risk,
          capability: pendingBatch.capability,
          target: pendingBatch.target,
          params: pendingBatch.params,
          approval: pendingBatch.approval,
          actions: pendingBatch.actions
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

  // 在真正调用本地能力前先恢复 LangGraph 审批, 保证自动授权路径也不会绕过工作流.
  async function executeApprovedAction(action: PendingActionDto, remember: boolean) {
    const approval = await deps.agentRuntime.resumePendingActionApproval(action, { type: "approve" });
    if (!approval.ok) return approval;
    return actionExecutor.execute({ action, remember });
  }

  // 保存一个待确认动作并分配一次性确认令牌.
  function storePendingAction(action: PendingActionDto): PendingActionDto & { id: string } {
    const actionId = crypto.randomUUID();
    const pendingAction = { ...action, id: actionId };
    pruneExpiredPendingActions();
    pendingActions.set(actionId, { action: pendingAction, createdAt: Date.now() });
    return pendingAction;
  }

  // 删除过期 pending action 时同步清理 runtime 内的 LangGraph 审批会话.
  function pruneExpiredPendingActions() {
    discardPendingActionApprovals(removeExpiredPendingActions(pendingActions, Date.now()));
  }

  // 批量丢弃不再可见的审批动作, 避免用户无法确认的 action 继续占用会话.
  function discardPendingActionApprovals(entries: PendingActionEntry[]) {
    for (const entry of entries) {
      deps.agentRuntime.discardPendingActionApproval(entry.action);
    }
  }

  // 清空所有待确认动作前先通知 runtime, 让审批会话和 UI 状态一起失效.
  function clearPendingActions() {
    discardPendingActionApprovals([...pendingActions.values()]);
    pendingActions.clear();
  }

  // 同一个 requestId 重入时先中止旧流, 避免旧请求失去 controller 后继续后台运行.
  function abortPreviousStreamController(requestId: string) {
    const previousController = streamControllers.get(requestId);
    if (!previousController) return;
    previousController.abort();
    streamControllers.delete(requestId);
  }
}

// 校验聊天输入, 无效时返回 null 供 IPC 层降级处理.
// 清理已经过期的待确认动作, 避免很久之前的授权被重新执行.
function removeExpiredPendingActions(pendingActions: Map<string, PendingActionEntry>, now: number): PendingActionEntry[] {
  const removed: PendingActionEntry[] = [];
  for (const [actionId, entry] of pendingActions) {
    if (now - entry.createdAt > PENDING_ACTION_TTL_MS) {
      pendingActions.delete(actionId);
      removed.push(entry);
    }
  }
  return removed;
}

// 校验聊天输入, 无效时返回 null 供 IPC 层降级处理.
// 清理同一个审批线程下的兄弟动作, 避免选择应用后其它候选项残留到 TTL 过期.
function removeSiblingPendingActions(pendingActions: Map<string, PendingActionEntry>, action: PendingActionDto): PendingActionEntry[] {
  const threadId = action.approval?.threadId;
  if (!threadId) return [];

  const removed: PendingActionEntry[] = [];
  for (const [actionId, entry] of pendingActions) {
    if (entry.action.approval?.threadId === threadId) {
      pendingActions.delete(actionId);
      removed.push(entry);
    }
  }
  return removed;
}

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
  return typeof request.remember === "boolean" && isPendingActionRequestAction(request.action);
}

// 校验取消动作请求, 只允许取消仍在待确认表中的动作.
function isCancelActionRequest(value: unknown): value is CancelActionRequest {
  if (!value || typeof value !== "object") return false;
  const request = value as CancelActionRequest;
  if (request.reason !== undefined && typeof request.reason !== "string") return false;
  return isPendingActionRequestAction(request.action);
}

// 校验跨 IPC 传入的待确认动作结构, 具体能力再交给 isSupportedAction 限制.
function isPendingActionRequestAction(action: unknown, depth = 0): action is PendingActionDto {
  if (
    !!action &&
    typeof action === "object" &&
    ((action as PendingActionDto).id === undefined || typeof (action as PendingActionDto).id === "string") &&
    typeof (action as PendingActionDto).title === "string" &&
    typeof (action as PendingActionDto).source === "string" &&
    ((action as PendingActionDto).risk === "low" ||
      (action as PendingActionDto).risk === "medium" ||
      (action as PendingActionDto).risk === "high") &&
    typeof (action as PendingActionDto).capability === "string" &&
    typeof (action as PendingActionDto).target === "string"
  ) {
    return isSupportedAction(action as PendingActionDto, depth);
  }
  return false;
}

// 判断待执行动作是否在当前版本支持的安全范围内.
function isSupportedAction(action: PendingActionDto, depth = 0): boolean {
  if (action.title.length > 180 || action.source.length > 1000 || action.target.length > 2048) return false;

  if (action.capability === "batch_actions") {
    const actions = action.actions;
    return (
      depth === 0 &&
      action.target === "batch" &&
      Array.isArray(actions) &&
      actions.length > 0 &&
      actions.length <= MAX_BATCH_ACTIONS &&
      actions.every((childAction) => {
        return (
          childAction.capability !== "batch_actions" &&
          childAction.choices === undefined &&
          isPendingActionRequestAction(childAction, depth + 1)
        );
      })
    );
  }

  if (action.capability === "open_url") {
    try {
      const url = new URL(action.target);
      return url.protocol === "http:" || url.protocol === "https:";
    } catch {
      return false;
    }
  }

  if (action.capability === "open_application") {
    const applicationPath = action.params?.applicationPath;
    return (
      action.target.trim().length > 0 &&
      action.target.length <= 180 &&
      (applicationPath === undefined || (typeof applicationPath === "string" && applicationPath.length <= 2048))
    );
  }

  if (action.capability === "create_reminder") {
    const params = action.params;
    const hasTitle = typeof params?.title === "string" && params.title.trim().length > 0 && params.title.length <= 180;
    const triggerAt = params?.triggerAt;
    if (hasTitle && typeof triggerAt === "string") {
      const triggerTime = new Date(triggerAt).getTime();
      return triggerAt.length <= 80 && Number.isFinite(triggerTime);
    }

    return (
      !!params &&
      typeof params.amount === "number" &&
      Number.isInteger(params.amount) &&
      params.amount > 0 &&
      params.amount <= 525600 &&
      (params.unit === "minutes" || params.unit === "hours") &&
      hasTitle
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
    JSON.stringify(left.params ?? {}) === JSON.stringify(right.params ?? {}) &&
    JSON.stringify(left.approval ?? {}) === JSON.stringify(right.approval ?? {}) &&
    JSON.stringify(left.actions ?? []) === JSON.stringify(right.actions ?? [])
  );
}
