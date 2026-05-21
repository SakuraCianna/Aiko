export type PendingAction = {
  title: string;
  source: string;
  risk: "low" | "medium" | "high";
};

type ConfirmDialogProps = {
  action: PendingAction | null;
  onOnce: () => void;
  onAlways: () => void;
  onCancel: () => void;
};

// 渲染本地动作执行前的用户确认弹窗.
export function ConfirmDialog({ action, onOnce, onAlways, onCancel }: ConfirmDialogProps) {
  if (!action) return null;

  const riskLabel = action.risk === "low" ? "低" : action.risk === "medium" ? "中" : "高";

  return (
    <div className="dialog-backdrop">
      <section className="confirm-dialog">
        <h2>{action.title}</h2>
        <p>来源:{action.source}</p>
        <p>风险:{riskLabel}</p>
        <div className="dialog-actions">
          <button type="button" onClick={onOnce}>
            仅这一次
          </button>
          <button type="button" onClick={onAlways}>
            以后不再询问
          </button>
          <button type="button" onClick={onCancel}>
            取消
          </button>
        </div>
      </section>
    </div>
  );
}
