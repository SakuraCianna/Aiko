import { useRef, useState } from "react";
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

export function App() {
  const [message, setMessage] = useState("");
  const [pendingAction, setPendingAction] = useState<(PendingAction & PendingActionDto) | null>(null);
  const [activePanel, setActivePanel] = useState<PanelName | null>(null);
  const [clickThrough, setClickThrough] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(false);
  const hideControlsTimerRef = useRef<number | null>(null);

  async function handleCommand(payload: ChatPayload) {
    setMessage("我听到了，正在处理。");
    showControls();

    try {
      const response = await window.aiko.sendMessage(payload);
      setMessage(response.message);
      showControls();
      if (response.pendingAction) {
        setPendingAction({
          title: response.pendingAction.title,
          source: response.pendingAction.source,
          risk: response.pendingAction.risk,
          capability: response.pendingAction.capability,
          target: response.pendingAction.target,
          params: response.pendingAction.params
        });
      }
    } catch {
      setMessage("我这边暂时没收到回复，但本地功能还在。");
      showControls();
    }
  }

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

  async function toggleClickThrough() {
    const next = !clickThrough;
    setClickThrough(next);
    await window.aiko.setClickThrough(next);
    setMessage(next ? "点击穿透已开启。用托盘或快捷键可以再叫我。" : "点击穿透已关闭。");
  }

  function showControls() {
    if (hideControlsTimerRef.current !== null) {
      window.clearTimeout(hideControlsTimerRef.current);
      hideControlsTimerRef.current = null;
    }
    setControlsVisible(true);
  }

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
          setMessage("已取消。");
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
              {activePanel === "memory" && <MemoryPanel />}
              {activePanel === "settings" && <SettingsPanel />}
            </PanelShell>
          </div>
        </div>
      )}
    </main>
  );
}
