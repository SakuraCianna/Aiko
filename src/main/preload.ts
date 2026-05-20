import { contextBridge, ipcRenderer } from "electron";
import type { AikoApi } from "../shared/ipcTypes";

const api: AikoApi = {
  ping: () => ipcRenderer.invoke("aiko:ping"),
  setClickThrough: (enabled) => ipcRenderer.invoke("window:set-click-through", enabled),
  openPanel: (panel) => ipcRenderer.invoke("window:open-panel", panel),
  sendMessage: (payload) => ipcRenderer.invoke("chat:send-message", payload),
  executeAction: (request) => ipcRenderer.invoke("action:execute", request)
};

contextBridge.exposeInMainWorld("aiko", api);
