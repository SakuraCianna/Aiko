import type { PanelName } from "../../shared/ipcTypes";

type PanelShellProps = {
  activePanel: PanelName;
  onPanelChange: (panel: PanelName) => void;
  children: React.ReactNode;
};

const panels: Array<{ id: PanelName; label: string }> = [
  { id: "chat", label: "聊天" },
  { id: "reminders", label: "提醒" },
  { id: "memory", label: "记忆" },
  { id: "agent", label: "Agent" },
  { id: "audit", label: "审计" },
  { id: "settings", label: "设置" }
];

// 渲染设置面板外壳和顶部标签切换.
export function PanelShell({ activePanel, onPanelChange, children }: PanelShellProps) {
  return (
    <section className="panel-shell">
      <nav className="panel-tabs">
        {panels.map((panel) => (
          <button
            key={panel.id}
            type="button"
            className={panel.id === activePanel ? "active" : ""}
            onClick={() => onPanelChange(panel.id)}
          >
            {panel.label}
          </button>
        ))}
      </nav>
      <div className="panel-body">{children}</div>
    </section>
  );
}
