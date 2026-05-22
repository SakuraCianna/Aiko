import { contextBridge, ipcRenderer } from "electron";
import type { AikoApi, ChatStreamDelta } from "../shared/ipcTypes";

const api: AikoApi = {
  // 测试主进程 IPC 是否可用.
  ping: () => ipcRenderer.invoke("aiko:ping"),
  // 切换桌宠窗口是否穿透鼠标事件.
  setClickThrough: (enabled) => ipcRenderer.invoke("window:set-click-through", enabled),
  // 读取系统鼠标坐标和桌宠窗口位置, 用于窗口外视线跟踪.
  getCursorState: () => ipcRenderer.invoke("window:get-cursor-state"),
  // 开始拖拽桌宠窗口.
  startWindowDrag: (point) => ipcRenderer.invoke("window:drag-start", point),
  // 根据鼠标屏幕坐标移动桌宠窗口.
  moveWindowDrag: (point) => ipcRenderer.invoke("window:drag-move", point),
  // 结束当前桌宠窗口拖拽.
  endWindowDrag: () => ipcRenderer.invoke("window:drag-end"),
  // 打开指定的管理面板.
  openPanel: (panel) => ipcRenderer.invoke("window:open-panel", panel),
  // 发送一次普通聊天请求.
  sendMessage: (payload) => ipcRenderer.invoke("chat:send-message", payload),
  // 发送一次流式聊天请求.
  streamMessage: (requestId, payload) => ipcRenderer.invoke("chat:stream-message", requestId, payload),
  // 订阅聊天流式增量事件.
  onChatStreamDelta: (listener) => {
    // 把主进程流式消息转成渲染层回调.
    const handler = (_event: Electron.IpcRendererEvent, delta: ChatStreamDelta) => listener(delta);
    ipcRenderer.on("chat:stream-delta", handler);
    return () => ipcRenderer.removeListener("chat:stream-delta", handler);
  },
  // 确认并执行一个待确认动作.
  executeAction: (request) => ipcRenderer.invoke("action:execute", request),
  // 读取长期记忆和待确认记忆候选.
  listMemory: () => ipcRenderer.invoke("memory:list"),
  // 接受一条待确认记忆候选.
  acceptMemoryCandidate: (candidateId) => ipcRenderer.invoke("memory:accept-candidate", candidateId),
  // 拒绝一条待确认记忆候选.
  rejectMemoryCandidate: (candidateId) => ipcRenderer.invoke("memory:reject-candidate", candidateId)
};

contextBridge.exposeInMainWorld("aiko", api);
