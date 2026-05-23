import { app, type BrowserWindow } from "electron";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createAikoAgentRuntime } from "./agent/aikoAgentRuntime";
import { loadConfig } from "./config/env";
import type { AikoDatabase } from "./database/connection";
import { openDatabase } from "./database/connection";
import {
  createApplicationPreferenceRepository,
  createMemoryRepository,
  createPermissionRepository,
  createReminderRepository
} from "./database/repositories";
import { registerAikoHandlers } from "./ipc/handlers";
import { createPanelWindow } from "./windows/panelWindow";
import { createPetWindow, loadRenderer } from "./windows/petWindow";
import { resolvePreloadPath } from "./windows/preloadPath";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const preloadPath = resolvePreloadPath(__dirname);
let database: AikoDatabase | null = null;

configureDevelopmentSessionData();

void app.whenReady().then(() => {
  const petWindow = createPetWindow(preloadPath);
  const panelWindow = createPanelWindow(preloadPath);
  const config = loadConfig();
  database = openDatabase();
  const memoryRepository = createMemoryRepository(database.db);
  const agentRuntime = createAikoAgentRuntime({ config, memoryRuntime: memoryRepository });
  const permissionRepository = createPermissionRepository(database.db);
  const reminderRepository = createReminderRepository(database.db);
  const applicationPreferenceRepository = createApplicationPreferenceRepository(database.db);

  loadRenderer(petWindow, __dirname);
  loadRenderer(panelWindow, __dirname);
  attachRendererDiagnostics("pet", petWindow);
  attachRendererDiagnostics("panel", panelWindow);
  registerAikoHandlers({
    agentRuntime,
    petWindow,
    panelWindow,
    memoryRepository,
    permissionRepository,
    reminderRepository,
    applicationPreferenceRepository
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  database?.close();
  database = null;
});

// 开发模式下给 Chromium cache 使用独立目录, 避免多实例抢占 cache.
function configureDevelopmentSessionData() {
  if (app.isPackaged) return;
  app.setPath("sessionData", path.join(app.getPath("temp"), `aiko-desktop-pet-session-${process.pid}`));
}

// 打印 renderer 侧错误, 方便定位 VRM 和 WebGL 加载失败.
function attachRendererDiagnostics(name: string, win: BrowserWindow) {
  win.webContents.on("console-message", (event) => {
    const { level, lineNumber, message, sourceId } = event;
    const line = `[renderer:${name}] ${message} (${sourceId}:${lineNumber})`;
    if (level === "error") {
      console.error(line);
    } else if (level === "warning") {
      console.warn(line);
    } else {
      console.log(line);
    }
  });
  win.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedUrl) => {
    console.error(`[renderer:${name}] failed to load ${validatedUrl}: ${errorCode} ${errorDescription}`);
  });
  win.webContents.on("render-process-gone", (_event, details) => {
    console.error(`[renderer:${name}] render process gone: ${details.reason}`);
  });
}
