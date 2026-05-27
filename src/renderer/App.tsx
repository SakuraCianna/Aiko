import { useEffect, useRef, useState } from "react";
import type { ChatPayload } from "../shared/chatPayload";
import type { AikoProactiveMessage, PendingActionDto, PanelName } from "../shared/ipcTypes";
import type { CharacterBehavior, CharacterMotion } from "./character/characterTypes";
import { ActionAuditPanel } from "./components/ActionAuditPanel";
import { AgentDebugPanel } from "./components/AgentDebugPanel";
import { ChatPanel } from "./components/ChatPanel";
import { CommandInput } from "./components/CommandInput";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { MemoryPanel } from "./components/MemoryPanel";
import { PanelShell } from "./components/PanelShell";
import { PetStage } from "./components/PetStage";
import { ReminderPanel } from "./components/ReminderPanel";
import { SettingsPanel } from "./components/SettingsPanel";
import { isCancellationCommand } from "./chat/cancelCommand";
import { selectActionForCancellation } from "./chat/pendingAction";
import { selectAgentStatusCue } from "./character/agentStatusMotion";
import {
  selectActionResultCue,
  selectCancelMotion,
  selectInitialCharacterCue,
  selectSpeechMotion
} from "./character/motionCues";
import { createAikoSpeechController, type AikoSpeechController } from "./voice/speechOutput";

// 渲染桌宠主界面, 负责聊天, 待确认动作和面板状态.
export function App() {
  const [message, setMessage] = useState("");
  const [pendingAction, setPendingAction] = useState<PendingActionDto | null>(null);
  const [activePanel, setActivePanel] = useState<PanelName | null>(null);
  const [clickThrough, setClickThrough] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(false);
  const [characterBehavior, setCharacterBehavior] = useState<CharacterBehavior>("idle");
  const [motionRequest, setMotionRequest] = useState<{ motion: CharacterMotion; id: number } | null>(null);
  const speechControllerRef = useRef<AikoSpeechController | null>(null);
  const hideControlsTimerRef = useRef<number | null>(null);
  const characterIdleTimerRef = useRef<number | null>(null);
  const activeStreamIdRef = useRef<string | null>(null);
  const streamMotionPlayedRef = useRef(false);

  useEffect(() => {
    speechControllerRef.current = createAikoSpeechController();
    const unsubscribeStreamDeltas = window.aiko.onChatStreamDelta((delta) => {
      if (!isActiveRequest(delta.requestId)) return;
      setCharacterBehaviorNow("speaking");
      if (!streamMotionPlayedRef.current && delta.text.trim().length > 0) {
        streamMotionPlayedRef.current = true;
        requestCharacterMotion("explain");
      }
      setMessage((current) => (current === "正在思考..." ? delta.text : `${current}${delta.text}`));
      showControls();
    });
    const unsubscribeAgentStatus = window.aiko.onAgentStatus(handleAgentStatus);
    const unsubscribeProactiveMessages = window.aiko.onProactiveMessage(handleProactiveMessage);

    return () => {
      const activeRequestId = activeStreamIdRef.current;
      if (activeRequestId) void window.aiko.cancelStream(activeRequestId);
      unsubscribeStreamDeltas();
      unsubscribeAgentStatus();
      unsubscribeProactiveMessages();
      speechControllerRef.current?.cancel();
      speechControllerRef.current = null;
      clearHideControlsTimer();
      clearCharacterIdleTimer();
      activeStreamIdRef.current = null;
    };
  }, []);

  // 判断指定请求是否仍然是当前活跃的流式请求.
  function isActiveRequest(requestId: string) {
    return activeStreamIdRef.current === requestId;
  }

  // 展示主进程主动推送的陪伴消息, 不打断正在输出的用户请求.
  function handleProactiveMessage(proactive: AikoProactiveMessage) {
    if (activeStreamIdRef.current) return;
    setMessage(proactive.message);
    speakAiko(proactive.message, "idle", "speaking", "notice");
    showControls();
  }

  // 根据主进程发来的 Agent 阶段事件更新角色动作, 让 VRM 不只依赖前端猜测.
  function handleAgentStatus(status: Parameters<typeof selectAgentStatusCue>[0]) {
    if (status.requestId && activeStreamIdRef.current && status.requestId !== activeStreamIdRef.current) return;
    const cue = selectAgentStatusCue(status);
    if (!cue) return;
    setCharacterBehaviorNow(cue.behavior);
    requestCharacterMotion(cue.motion);
    showControls();
  }

  // 发送用户输入到主进程 Agent, 并接收流式回复.
  async function handleCommand(payload: ChatPayload) {
    if (payload.attachments.length === 0 && isCancellationCommand(payload.text)) {
      cancelActiveResponse();
      return;
    }

    cancelPreviousResponseBeforeNewRequest();
    const requestId = crypto.randomUUID();
    activeStreamIdRef.current = requestId;
    streamMotionPlayedRef.current = false;
    setPendingAction(null);
    setMessage("正在思考...");
    const initialCue = selectInitialCharacterCue(payload);
    setCharacterBehaviorNow(initialCue.behavior);
    requestCharacterMotion(initialCue.motion);
    showControls();

    try {
      const response = await window.aiko.streamMessage(requestId, payload);
      if (!isActiveRequest(requestId)) return;
      activeStreamIdRef.current = null;
      setMessage(response.message);
      showControls();
      if (response.pendingAction) {
        speakAiko(response.message, "confirming", "speaking", "notice");
        setPendingAction({
          id: response.pendingAction.id,
          title: response.pendingAction.title,
          source: response.pendingAction.source,
          risk: response.pendingAction.risk,
          capability: response.pendingAction.capability,
          target: response.pendingAction.target,
          params: response.pendingAction.params,
          approval: response.pendingAction.approval,
          choices: response.pendingAction.choices,
          actions: response.pendingAction.actions
        });
      } else {
        speakAiko(response.message, "idle");
      }
    } catch {
      if (!isActiveRequest(requestId)) return;
      activeStreamIdRef.current = null;
      const fallbackMessage = "我这边暂时没有收到回复, 但本地功能还在.";
      setMessage(fallbackMessage);
      setCharacterBehaviorNow("failure");
      speakAiko(fallbackMessage, "idle", "failure", "deny");
      showControls();
    }
  }

  // 中止当前流式回复, 同时停止 UI 增量, 主进程请求和语音播放.
  function cancelActiveResponse() {
    const requestId = activeStreamIdRef.current;
    const actionToCancel = pendingAction;
    activeStreamIdRef.current = null;
    setPendingAction(null);
    speechControllerRef.current?.cancel();

    if (requestId) {
      void window.aiko.cancelStream(requestId);
      const cancelMessage = "已中止. 我先停下.";
      setMessage(cancelMessage);
      setCharacterBehaviorNow("idle");
      requestCharacterMotion(selectCancelMotion(true));
      showControls();
      return;
    }

    if (actionToCancel) {
      void cancelPendingAction(actionToCancel);
      return;
    }

    const idleMessage = "现在没有正在输出的回复.";
    setMessage(idleMessage);
    setCharacterBehaviorNow("idle");
    showControls();
  }

  // 新请求开始前安静取消旧请求, 避免旧模型流继续占用调用或留下过期动作.
  function cancelPreviousResponseBeforeNewRequest() {
    const previousRequestId = activeStreamIdRef.current;
    const actionToCancel = selectActionForCancellation(pendingAction);
    if (actionToCancel) void window.aiko.cancelAction({ action: actionToCancel, reason: "replaced_by_new_request" });
    if (!previousRequestId) return;

    activeStreamIdRef.current = null;
    void window.aiko.cancelStream(previousRequestId);
    speechControllerRef.current?.cancel();
  }

  // 执行当前待确认动作, 可选择是否记住授权.
  async function executePendingAction(remember: boolean, selectedAction: PendingActionDto | null = pendingAction) {
    if (!selectedAction) return;
    const result = await window.aiko.executeAction({
      action: selectedAction,
      remember
    });
    const resultCue = selectActionResultCue(result.ok);
    setMessage(result.message);
    speakAiko(result.message, "idle", resultCue.behavior, resultCue.motion);
    showControls();
    setPendingAction(null);
  }

  // 从审计面板准备一个需要确认的动作, 例如从 Aiko trash 恢复文件.
  function handleAuditProposedAction(action: PendingActionDto, nextMessage?: string) {
    setPendingAction(action);
    if (nextMessage) setMessage(nextMessage);
    showControls();
  }

  // 切换窗口点击穿透状态.
  // 拒绝当前待确认动作, 通知主进程恢复 LangGraph 审批并清理会话.
  async function cancelPendingAction(action: PendingActionDto | null = pendingAction) {
    const actionToCancel = selectActionForCancellation(action);
    if (!actionToCancel) return;
    const result = await window.aiko.cancelAction({
      action: actionToCancel,
      reason: "user_cancelled"
    });
    const cancelMessage = result.message || "已取消. 我先把手收回来.";
    setMessage(cancelMessage);
    speakAiko(cancelMessage, "idle", "failure", selectCancelMotion(false));
    showControls();
    setPendingAction(null);
  }

  async function toggleClickThrough() {
    const next = !clickThrough;
    setClickThrough(next);
    await window.aiko.setClickThrough(next);
    const statusMessage = next ? "点击穿透已开启. 用托盘或快捷键可以再叫我." : "点击穿透已关闭.";
    setMessage(statusMessage);
    speakAiko(statusMessage, next ? "asleep" : "idle", next ? "asleep" : "speaking", next ? "settle" : "wake");
  }

  // 清理隐藏控件计时器, 防止卸载后继续写入状态.
  function clearHideControlsTimer() {
    if (hideControlsTimerRef.current === null) return;
    window.clearTimeout(hideControlsTimerRef.current);
    hideControlsTimerRef.current = null;
  }

  // 清理角色回待机计时器, 防止异步状态互相覆盖.
  function clearCharacterIdleTimer() {
    if (characterIdleTimerRef.current === null) return;
    window.clearTimeout(characterIdleTimerRef.current);
    characterIdleTimerRef.current = null;
  }

  // 立即切换角色持续行为状态.
  function setCharacterBehaviorNow(behavior: CharacterBehavior) {
    clearCharacterIdleTimer();
    setCharacterBehavior(behavior);
  }

  // 请求播放一次性动作, id 用于允许连续播放同一种动作.
  function requestCharacterMotion(motion: CharacterMotion) {
    setMotionRequest({ motion, id: Date.now() + Math.random() });
  }

  // 延迟回到待机, 让说话或反馈动作保留一小段时间.
  function returnCharacterToIdleSoon(delayMs: number) {
    clearCharacterIdleTimer();
    characterIdleTimerRef.current = window.setTimeout(() => {
      setCharacterBehavior("idle");
      characterIdleTimerRef.current = null;
    }, delayMs);
  }

  // 用语音播放 Aiko 回复, 并把角色状态, 动作和语音生命周期同步.
  function speakAiko(
    text: string,
    afterSpeech: CharacterBehavior = "idle",
    speakingBehavior: CharacterBehavior = "speaking",
    motion: CharacterMotion = selectSpeechMotion(text)
  ) {
    const controller = speechControllerRef.current;
    setCharacterBehaviorNow(speakingBehavior);
    requestCharacterMotion(motion);
    const started = controller?.speak(text, {
      onStart: () => setCharacterBehaviorNow(speakingBehavior),
      onEnd: () => {
        setCharacterBehavior(afterSpeech);
      },
      onError: () => {
        setCharacterBehavior(afterSpeech);
      }
    });

    if (!started) {
      scheduleSpeechFallback(afterSpeech);
      return;
    }

    void started
      .then((didStart) => {
        if (!didStart) scheduleSpeechFallback(afterSpeech);
      })
      .catch(() => scheduleSpeechFallback(afterSpeech));
  }

  // 语音不可用时仍然让角色短暂停留在说话动作, 避免 UI 直接僵住.
  function scheduleSpeechFallback(afterSpeech: CharacterBehavior) {
      clearCharacterIdleTimer();
      characterIdleTimerRef.current = window.setTimeout(() => {
        setCharacterBehavior(afterSpeech);
        characterIdleTimerRef.current = null;
      }, 1200);
  }

  // 显示输入控件并取消隐藏计时器.
  function showControls() {
    clearHideControlsTimer();
    setControlsVisible(true);
  }

  // 延迟隐藏输入控件, 避免鼠标移动时闪烁.
  function hideControlsSoon() {
    clearHideControlsTimer();
    hideControlsTimerRef.current = window.setTimeout(() => {
      setControlsVisible(false);
      hideControlsTimerRef.current = null;
    }, 320);
  }

  return (
    <main className="app-root">
      <div className="pet-interaction-zone">
        <PetStage
          behavior={characterBehavior}
          motionRequest={motionRequest}
          onOpenSettings={() => setActivePanel("settings")}
          onToggleClickThrough={toggleClickThrough}
          onControlsEnter={showControls}
          onControlsLeave={hideControlsSoon}
        />
        <div
          className={`hover-controls${controlsVisible ? " controls-visible" : ""}`}
          onMouseEnter={showControls}
          onMouseLeave={hideControlsSoon}
          onFocus={showControls}
        >
          <CommandInput onSubmit={handleCommand} />
        </div>
      </div>
      <ConfirmDialog
        action={pendingAction}
        onOnce={() => void executePendingAction(false)}
        onAlways={() => void executePendingAction(true)}
        onChoose={(action) => void executePendingAction(false, action)}
        onChooseDefault={(action) => void executePendingAction(true, action)}
        onCancel={() => void cancelPendingAction()}
      />
      {activePanel && (
        <div className="panel-backdrop" onMouseDown={() => setActivePanel(null)}>
          <div onMouseDown={(event) => event.stopPropagation()}>
            <PanelShell activePanel={activePanel} onPanelChange={setActivePanel}>
              {activePanel === "chat" && <ChatPanel />}
              {activePanel === "reminders" && <ReminderPanel onStatus={setMessage} />}
              {activePanel === "memory" && <MemoryPanel onStatus={setMessage} />}
              {activePanel === "agent" && <AgentDebugPanel />}
              {activePanel === "audit" && <ActionAuditPanel onProposeAction={handleAuditProposedAction} />}
              {activePanel === "settings" && <SettingsPanel />}
            </PanelShell>
          </div>
        </div>
      )}
    </main>
  );
}
