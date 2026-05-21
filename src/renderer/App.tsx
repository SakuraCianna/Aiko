import { useEffect, useRef, useState } from "react";
import type { ChatPayload } from "../shared/chatPayload";
import type { PendingActionDto, PanelName } from "../shared/ipcTypes";
import { ChatPanel } from "./components/ChatPanel";
import { CommandInput } from "./components/CommandInput";
import { ConfirmDialog, type PendingAction } from "./components/ConfirmDialog";
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
  const hideControlsTimerRef = useRef<number | null>(null);
  const activeStreamIdRef = useRef<string | null>(null);

  useEffect(() => {
    return window.aiko.onChatStreamDelta((delta) => {
      if (delta.requestId !== activeStreamIdRef.current) return;
      setMessage((current) => (current === "正在思考..." ? delta.text : `${current}${delta.text}`));
      showControls();
    });
  }, []);

  // 发送用户输入到主进程 Agent, 并接收流式回复.
  async function handleCommand(payload: ChatPayload) {
    const requestId = crypto.randomUUID();
    activeStreamIdRef.current = requestId;
    setMessage("正在思考...");
    showControls();

    try {
      const response = await window.aiko.streamMessage(requestId, payload);
      activeStreamIdRef.current = null;
      setMessage(response.message);
      showControls();
      if (response.pendingAction) {
        setPendingAction({
          id: response.pendingAction.id,
          title: response.pendingAction.title,
          source: response.pendingAction.source,
          risk: response.pendingAction.risk,
          capability: response.pendingAction.capability,
          target: response.pendingAction.target,
          params: response.pendingAction.params
        });
      }
    } catch {
      activeStreamIdRef.current = null;
      setMessage("我这边暂时没有收到回复,但本地功能还在.");
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
    showControls();
    setPendingAction(null);
  }

  // 切换窗口点击穿透状态.
  async function toggleClickThrough() {
    const next = !clickThrough;
    setClickThrough(next);
    await window.aiko.setClickThrough(next);
    setMessage(next ? "点击穿透已开启.用托盘或快捷键可以再叫我." : "点击穿透已关闭.");
  }

  // 显示输入控件并取消隐藏计时器.
  function showControls() {
    if (hideControlsTimerRef.current !== null) {
      window.clearTimeout(hideControlsTimerRef.current);
      hideControlsTimerRef.current = null;
    }
    setControlsVisible(true);
  }

  // 延迟隐藏输入控件, 避免鼠标移动时闪烁.
  function hideControlsSoon() {
    if (hideControlsTimerRef.current !== null) {
      window.clearTimeout(hideControlsTimerRef.current);
    }
    hideControlsTimerRef.current = window.setTimeout(() => {
      setControlsVisible(false);
      hideControlsTimerRef.current = null;
    }, 320);
  }

  return (
    <main className="app-root">
      <div className="pet-interaction-zone">
        <PetStage
          onOpenSettings={() => setActivePanel("settings")}
          onToggleClickThrough={toggleClickThrough}
          onControlsEnter={showControls}
          onControlsLeave={hideControlsSoon}
        />
        {message && (
          <div className="pet-reply" role="status">
            {message}
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
