import { contextBridge, ipcRenderer } from "electron";
import type {
  AikoAgentStatusEventDto,
  AikoApi,
  AikoProactiveMessage,
  ChatStreamDelta,
  SpeechTranscriptDelta
} from "../shared/ipcTypes";

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
  // 调用主进程本地 TTS provider, 成功时返回可播放的音频 data URL.
  synthesizeSpeech: (request) => ipcRenderer.invoke("voice:synthesize", request),
  // 读取本地 ASR/TTS provider 健康状态.
  getVoiceStatus: () => ipcRenderer.invoke("voice:status"),
  // 开启流式 ASR 会话.
  startSpeechStream: (request) => ipcRenderer.invoke("voice:stream-start", request),
  // 推送一段 PCM16LE 语音分片.
  pushSpeechStreamChunk: (request) => ipcRenderer.invoke("voice:stream-chunk", request),
  // 结束流式 ASR 会话并读取最终转写.
  finishSpeechStream: (request) => ipcRenderer.invoke("voice:stream-finish", request),
  // 取消流式 ASR 会话并释放主进程缓存.
  cancelSpeechStream: (request) => ipcRenderer.invoke("voice:stream-cancel", request),
  // 订阅聊天流式增量事件.
  onChatStreamDelta: (listener) => {
    // 把主进程流式消息转成渲染层回调.
    const handler = (_event: Electron.IpcRendererEvent, delta: ChatStreamDelta) => listener(delta);
    ipcRenderer.on("chat:stream-delta", handler);
    return () => ipcRenderer.removeListener("chat:stream-delta", handler);
  },
  // 订阅语音转写增量, 当前 buffered provider 只会发送最终结果.
  onSpeechTranscriptDelta: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, delta: SpeechTranscriptDelta) => listener(delta);
    ipcRenderer.on("voice:transcript-delta", handler);
    return () => ipcRenderer.removeListener("voice:transcript-delta", handler);
  },
  // 订阅 Agent 生命周期状态, 用于驱动桌宠动作和调试展示.
  onAgentStatus: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, status: AikoAgentStatusEventDto) => listener(status);
    ipcRenderer.on("agent:status", handler);
    return () => ipcRenderer.removeListener("agent:status", handler);
  },
  // 订阅主进程主动推送的陪伴消息, 目前用于承诺心跳.
  onProactiveMessage: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, message: AikoProactiveMessage) => listener(message);
    ipcRenderer.on("aiko:proactive-message", handler);
    return () => ipcRenderer.removeListener("aiko:proactive-message", handler);
  },
  // 确认并执行一个待确认动作.
  executeAction: (request) => ipcRenderer.invoke("action:execute", request),
  // 拒绝一个待确认动作, 并恢复 LangGraph 审批会话.
  cancelAction: (request) => ipcRenderer.invoke("action:cancel", request),
  // 读取当前短期对话上下文.
  listConversation: () => ipcRenderer.invoke("conversation:list"),
  // 清空当前短期对话上下文.
  resetConversation: () => ipcRenderer.invoke("conversation:reset"),
  // 读取 Agent 调试快照, 用于管理面板观察运行链路.
  getAgentDebugSnapshot: () => ipcRenderer.invoke("agent:debug-snapshot"),
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
