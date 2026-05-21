import { app } from "electron";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createAikoAgentRuntime } from "./agent/aikoAgentRuntime";
import { loadConfig } from "./config/env";
import type { AikoDatabase } from "./database/connection";
import { openDatabase } from "./database/connection";
import { createMemoryRepository, createPermissionRepository, createReminderRepository } from "./database/repositories";
import { registerAikoHandlers } from "./ipc/handlers";
import { createPanelWindow } from "./windows/panelWindow";
import { createPetWindow, loadRenderer } from "./windows/petWindow";
import { resolvePreloadPath } from "./windows/preloadPath";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const preloadPath = resolvePreloadPath(__dirname);
let database: AikoDatabase | null = null;

void app.whenReady().then(() => {
  const petWindow = createPetWindow(preloadPath);
  const panelWindow = createPanelWindow(preloadPath);
  const config = loadConfig();
  database = openDatabase();
  const memoryRepository = createMemoryRepository(database.db);
  const agentRuntime = createAikoAgentRuntime({ config, memoryRuntime: memoryRepository });
  const permissionRepository = createPermissionRepository(database.db);
  const reminderRepository = createReminderRepository(database.db);

  loadRenderer(petWindow, __dirname);
  loadRenderer(panelWindow, __dirname);
  registerAikoHandlers({
    agentRuntime,
    petWindow,
    panelWindow,
    memoryRepository,
    permissionRepository,
    reminderRepository
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  database?.close();
  database = null;
});
