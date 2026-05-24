import { app, type BrowserWindow } from "electron";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createAikoAgentRuntime } from "./agent/aikoAgentRuntime";
import { createAikoCommitmentHeartbeat } from "./agent/commitments/commitmentHeartbeat";
import { createAikoCommitmentService } from "./agent/commitments/commitmentService";
import { createCommitmentProactiveMessage } from "./agent/commitments/proactiveCommitment";
import { createAikoActionJournal } from "./agent/runtime/actionJournal";
import { createAikoRuntimeHooks } from "./agent/runtime/runtimeHooks";
import { loadConfig } from "./config/env";
import type { AikoDatabase } from "./database/connection";
import { openDatabase } from "./database/connection";
import {
  createAuditRepository,
  createApplicationPreferenceRepository,
  createMemoryRepository,
  createPermissionRepository,
  createReminderRepository
} from "./database/repositories";
import { registerAikoHandlers } from "./ipc/handlers";
import { createAikoTraceRecorder } from "./agent/trace/aikoTrace";
import { createPanelWindow } from "./windows/panelWindow";
import { createPetWindow, loadRenderer } from "./windows/petWindow";
import { resolvePreloadPath } from "./windows/preloadPath";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const preloadPath = resolvePreloadPath(__dirname);
let database: AikoDatabase | null = null;
let stopCommitmentHeartbeat: (() => void) | null = null;

configureDevelopmentSessionData();

void app.whenReady().then(() => {
  const petWindow = createPetWindow(preloadPath);
  const panelWindow = createPanelWindow(preloadPath);
  const config = loadConfig();
  database = openDatabase();
  const memoryRepository = createMemoryRepository(database.db);
  const auditRepository = createAuditRepository(database.db);
  const actionJournal = createAikoActionJournal({ store: auditRepository });
  const traceRecorder = createAikoTraceRecorder({ store: auditRepository });
  const commitmentService = createAikoCommitmentService();
  const hooks = createAikoRuntimeHooks();
  const agentRuntime = createAikoAgentRuntime({
    config,
    memoryRuntime: memoryRepository,
    actionJournal,
    traceRecorder,
    commitmentService,
    hooks
  });
  const permissionRepository = createPermissionRepository(database.db);
  const reminderRepository = createReminderRepository(database.db);
  const applicationPreferenceRepository = createApplicationPreferenceRepository(database.db);

  loadRenderer(petWindow, __dirname);
  loadRenderer(panelWindow, __dirname);
  attachRendererDiagnostics("pet", petWindow);
  attachRendererDiagnostics("panel", panelWindow);
  registerAikoHandlers({
    agentRuntime,
    actionJournal,
    hooks,
    petWindow,
    panelWindow,
    memoryRepository,
    permissionRepository,
    reminderRepository,
    applicationPreferenceRepository
  });
  stopCommitmentHeartbeat = startCommitmentHeartbeat([petWindow, panelWindow], commitmentService);
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  stopCommitmentHeartbeat?.();
  stopCommitmentHeartbeat = null;
  database?.close();
  database = null;
});

// 启动承诺心跳, 把到期 follow-up 转成渲染层主动消息.
function startCommitmentHeartbeat(
  windows: BrowserWindow[],
  commitmentService: ReturnType<typeof createAikoCommitmentService>
) {
  const heartbeat = createAikoCommitmentHeartbeat({
    commitmentService,
    onDue(commitment) {
      sendProactiveMessage(windows, createCommitmentProactiveMessage(commitment));
    }
  });
  const interval = setInterval(() => {
    void heartbeat.tick();
  }, 60_000);
  interval.unref?.();
  void heartbeat.tick();

  return () => clearInterval(interval);
}

// 安全广播主动消息, 窗口销毁或 IPC 发送失败都不影响主进程.
function sendProactiveMessage(windows: BrowserWindow[], message: unknown) {
  for (const win of windows) {
    if (win.isDestroyed()) continue;
    try {
      win.webContents.send("aiko:proactive-message", message);
    } catch {
      continue;
    }
  }
}

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
