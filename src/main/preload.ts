import { contextBridge, ipcRenderer } from "electron";
import type { AikoApi, ChatStreamDelta } from "../shared/ipcTypes";

const api: AikoApi = {
  ping: () => ipcRenderer.invoke("aiko:ping"),
  setClickThrough: (enabled) => ipcRenderer.invoke("window:set-click-through", enabled),
  openPanel: (panel) => ipcRenderer.invoke("window:open-panel", panel),
  sendMessage: (payload) => ipcRenderer.invoke("chat:send-message", payload),
  streamMessage: (requestId, payload) => ipcRenderer.invoke("chat:stream-message", requestId, payload),
  onChatStreamDelta: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, delta: ChatStreamDelta) => listener(delta);
    ipcRenderer.on("chat:stream-delta", handler);
    return () => ipcRenderer.removeListener("chat:stream-delta", handler);
  },
  executeAction: (request) => ipcRenderer.invoke("action:execute", request),
  listMemory: () => ipcRenderer.invoke("memory:list"),
  acceptMemoryCandidate: (candidateId) => ipcRenderer.invoke("memory:accept-candidate", candidateId),
  rejectMemoryCandidate: (candidateId) => ipcRenderer.invoke("memory:reject-candidate", candidateId)
};

contextBridge.exposeInMainWorld("aiko", api);
