import { useEffect, useRef, useState } from "react";
import type { ChatPayload } from "../shared/chatPayload";
import type { PendingActionDto, PanelName } from "../shared/ipcTypes";
import type { CharacterBehavior, CharacterMotion } from "./character/characterTypes";
import { ChatPanel } from "./components/ChatPanel";
import { CommandInput } from "./components/CommandInput";
import { ConfirmDialog, type PendingAction } from "./components/ConfirmDialog";
import { MarkdownMessage } from "./components/MarkdownMessage";
import { MemoryPanel } from "./components/MemoryPanel";
import { PanelShell } from "./components/PanelShell";
import { PetStage } from "./components/PetStage";
import { ReminderPanel } from "./components/ReminderPanel";
import { SettingsPanel } from "./components/SettingsPanel";

// 渲染桌宠主界面, 负责聊天, 待确认动作和面板状态.
export function App() {
  const [message, setMessage] = useState("");
  const [pendingAction, setPendingAction] = useState<(PendingAction & PendingActionDto) | null>(null);
  const [activePanel, setActivePanel] = useState<PanelName | null>(null);
  const [clickThrough, setClickThrough] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(false);
  const [characterBehavior, setCharacterBehavior] = useState<CharacterBehavior>("idle");
  const [motionRequest, setMotionRequest] = useState<{ motion: CharacterMotion; id: number } | null>(null);
  const hideControlsTimerRef = useRef<number | null>(null);
  const characterIdleTimerRef = useRef<number | null>(null);
  const activeStreamIdRef = useRef<string | null>(null);

  useEffect(() => {
    const unsubscribeStreamDeltas = window.aiko.onChatStreamDelta((delta) => {
      if (!isActiveRequest(delta.requestId)) return;
      setCharacterBehaviorNow("speaking");
      setMessage((current) => (current === "正在思考..." ? delta.text : `${current}${delta.text}`));
      showControls();
    });

    return () => {
      unsubscribeStreamDeltas();
      clearHideControlsTimer();
      clearCharacterIdleTimer();
      activeStreamIdRef.current = null;
    };
  }, []);

  // 判断指定请求是否仍然是当前活跃的流式请求.
  function isActiveRequest(requestId: string) {
    return activeStreamIdRef.current === requestId;
  }

  // 发送用户输入到主进程 Agent, 并接收流式回复.
  async function handleCommand(payload: ChatPayload) {
    const requestId = crypto.randomUUID();
    activeStreamIdRef.current = requestId;
    setPendingAction(null);
    setMessage("正在思考...");
    setCharacterBehaviorNow("thinking");
    requestCharacterMotion("think");
    showControls();

    try {
      const response = await window.aiko.streamMessage(requestId, payload);
      if (!isActiveRequest(requestId)) return;
      activeStreamIdRef.current = null;
      setMessage(response.message);
      showControls();
      if (response.pendingAction) {
        setCharacterBehaviorNow("confirming");
        requestCharacterMotion("notice");
        setPendingAction({
          id: response.pendingAction.id,
          title: response.pendingAction.title,
          source: response.pendingAction.source,
          risk: response.pendingAction.risk,
          capability: response.pendingAction.capability,
          target: response.pendingAction.target,
          params: response.pendingAction.params
        });
      } else {
        setCharacterBehaviorNow("speaking");
        requestCharacterMotion("nod");
        returnCharacterToIdleSoon(1800);
      }
    } catch {
      if (!isActiveRequest(requestId)) return;
      activeStreamIdRef.current = null;
      setMessage("我这边暂时没有收到回复, 但本地功能还在.");
      setCharacterBehaviorNow("failure");
      requestCharacterMotion("failure");
      returnCharacterToIdleSoon(1600);
      showControls();
    }
  }

  // 执行当前待确认动作, 可选择是否记住授权.
  async function executePendingAction(remember: boolean) {
    if (!pendingAction) return;
    const result = await window.aiko.executeAction({
      action: pendingAction,
      remember
    });
    setMessage(result.message);
    setCharacterBehaviorNow(result.ok ? "success" : "failure");
    requestCharacterMotion(result.ok ? "success" : "failure");
    returnCharacterToIdleSoon(1500);
    showControls();
    setPendingAction(null);
  }

  // 切换窗口点击穿透状态.
  async function toggleClickThrough() {
    const next = !clickThrough;
    setClickThrough(next);
    await window.aiko.setClickThrough(next);
    setMessage(next ? "点击穿透已开启. 用托盘或快捷键可以再叫我." : "点击穿透已关闭.");
    setCharacterBehaviorNow(next ? "asleep" : "idle");
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
        {message && (
          <div className="pet-reply" role="status">
            <MarkdownMessage content={message} />
          </div>
        )}
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
        onCancel={() => {
          setMessage("已取消.");
          setCharacterBehaviorNow("failure");
          requestCharacterMotion("shake");
          returnCharacterToIdleSoon(1200);
          showControls();
          setPendingAction(null);
        }}
      />
      {activePanel && (
        <div className="panel-backdrop" onMouseDown={() => setActivePanel(null)}>
          <div onMouseDown={(event) => event.stopPropagation()}>
            <PanelShell activePanel={activePanel} onPanelChange={setActivePanel}>
              {activePanel === "chat" && <ChatPanel />}
              {activePanel === "reminders" && <ReminderPanel />}
              {activePanel === "memory" && <MemoryPanel onStatus={setMessage} />}
              {activePanel === "settings" && <SettingsPanel />}
            </PanelShell>
          </div>
        </div>
      )}
    </main>
  );
}
