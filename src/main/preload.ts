import { contextBridge, ipcRenderer } from "electron";
import type { AikoApi, ChatStreamDelta } from "../shared/ipcTypes";

const api: AikoApi = {
  // 测试主进程 IPC 是否可用.
  ping: () => ipcRenderer.invoke("aiko:ping"),
  // 切换桌宠窗口是否穿透鼠标事件.
  setClickThrough: (enabled) => ipcRenderer.invoke("window:set-click-through", enabled),
  // 读取系统鼠标坐标和桌宠窗口位置, 用于窗口外视线跟踪.
  getCursorState: () => ipcRenderer.invoke("window:get-cursor-state"),
  // 打开指定的管理面板.
  openPanel: (panel) => ipcRenderer.invoke("window:open-panel", panel),
  // 发送一次普通聊天请求.
  sendMessage: (payload) => ipcRenderer.invoke("chat:send-message", payload),
  // 发送一次流式聊天请求.
  streamMessage: (requestId, payload) => ipcRenderer.invoke("chat:stream-message", requestId, payload),
  // 取消指定流式聊天请求.
  cancelStream: (requestId) => ipcRenderer.invoke("chat:cancel-stream", requestId),
  // 订阅聊天流式增量事件.
  onChatStreamDelta: (listener) => {
    // 把主进程流式消息转成渲染层回调.
    const handler = (_event: Electron.IpcRendererEvent, delta: ChatStreamDelta) => listener(delta);
    ipcRenderer.on("chat:stream-delta", handler);
    return () => ipcRenderer.removeListener("chat:stream-delta", handler);
  },
  // 确认并执行一个待确认动作.
  executeAction: (request) => ipcRenderer.invoke("action:execute", request),
  // 读取当前短期对话上下文.
  listConversation: () => ipcRenderer.invoke("conversation:list"),
  // 清空当前短期对话上下文.
  resetConversation: () => ipcRenderer.invoke("conversation:reset"),
  // 读取长期记忆和待确认记忆候选.
  listMemory: () => ipcRenderer.invoke("memory:list"),
  // 接受一条待确认记忆候选.
  acceptMemoryCandidate: (candidateId) => ipcRenderer.invoke("memory:accept-candidate", candidateId),
  // 拒绝一条待确认记忆候选.
  rejectMemoryCandidate: (candidateId) => ipcRenderer.invoke("memory:reject-candidate", candidateId),
  // 读取本地提醒列表.
  listReminders: () => ipcRenderer.invoke("reminder:list"),
  // 更新提醒状态.
  updateReminderStatus: (reminderId, status) => ipcRenderer.invoke("reminder:update-status", reminderId, status),
  // 删除一条本地提醒.
  deleteReminder: (reminderId) => ipcRenderer.invoke("reminder:delete", reminderId)
};

contextBridge.exposeInMainWorld("aiko", api);
