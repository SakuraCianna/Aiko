import { BrowserWindow, ipcMain } from "electron";
import { createActionExecutor } from "../actions/actionExecutor";
import type { AikoAgentRuntime } from "../agent/aikoAgentRuntime";
import { openApplication } from "../capabilities/openApplication";
import { openUrl } from "../capabilities/openUrl";
import type { PermissionRepository, ReminderRepository } from "../database/repositories";
import { validateChatPayload, type ChatPayload } from "../../shared/chatPayload";
import type { ChatResponse, ExecuteActionRequest, PanelName, PendingActionDto } from "../../shared/ipcTypes";

export type AikoHandlerDeps = {
  agentRuntime: AikoAgentRuntime;
  petWindow: BrowserWindow;
  panelWindow: BrowserWindow;
  permissionRepository?: Pick<PermissionRepository, "remember" | "has" | "list">;
  reminderRepository?: Pick<ReminderRepository, "save" | "list">;
};

export function registerAikoHandlers(deps: AikoHandlerDeps) {
  const actionExecutor = createActionExecutor({
    openUrl,
    openApplication: (query) => openApplication(getDefaultApplications(), query),
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
    let payload: ChatPayload;
    try {
      payload = validateChatPayload(input);
    } catch {
      return { message: "这个输入我暂时不能处理，可能是附件格式或大小不符合要求。" };
    }

    try {
      const response = await deps.agentRuntime.respond(payload);
      if (response.pendingAction) {
        return respondWithLocalAction(response.message, response.pendingAction);
      }
      return response;
    } catch {
      return {
        message: "我这边暂时没收到回复，但本地功能还在。"
      };
    }
  });

  ipcMain.handle("action:execute", async (_event, request: unknown) => {
    if (!isExecuteActionRequest(request)) {
      return { ok: false, message: "这个操作请求格式不正确。" };
    }
    return actionExecutor.execute(request);
  });

  async function respondWithLocalAction(message: string, action: PendingActionDto): Promise<ChatResponse> {
    if (actionExecutor.isRememberedAction(action)) {
      const result = await actionExecutor.execute({ action, remember: false });
      return { message: result.message };
    }

    return { message, pendingAction: action };
  }
}

function isPanelName(value: unknown): value is PanelName {
  return value === "chat" || value === "reminders" || value === "memory" || value === "settings";
}

function isExecuteActionRequest(value: unknown): value is ExecuteActionRequest {
  if (!value || typeof value !== "object") return false;
  const request = value as ExecuteActionRequest;
  const action = request.action;
  return (
    typeof request.remember === "boolean" &&
    !!action &&
    typeof action === "object" &&
    typeof action.title === "string" &&
    typeof action.source === "string" &&
    (action.risk === "low" || action.risk === "medium" || action.risk === "high") &&
    typeof action.capability === "string" &&
    typeof action.target === "string"
  );
}

function getDefaultApplications() {
  const localAppData = process.env.LOCALAPPDATA;
  const programFiles = process.env.ProgramFiles;
  const apps = [];

  if (localAppData) {
    apps.push({
      name: "Visual Studio Code",
      aliases: ["VS Code", "vscode", "code"],
      path: `${localAppData}\\Programs\\Microsoft VS Code\\Code.exe`
    });
  }

  if (programFiles) {
    apps.push({
      name: "Google Chrome",
      aliases: ["Chrome", "chrome", "浏览器"],
      path: `${programFiles}\\Google\\Chrome\\Application\\chrome.exe`
    });
  }

  return apps;
}
