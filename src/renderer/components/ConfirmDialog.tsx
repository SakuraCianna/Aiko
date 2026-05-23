import type { PendingActionChoiceDto, PendingActionDto } from "../../shared/ipcTypes";

type ConfirmDialogProps = {
  action: PendingActionDto | null;
  onOnce: () => void;
  onAlways: () => void;
  onChoose: (action: PendingActionChoiceDto["action"]) => void;
  onChooseDefault: (action: PendingActionChoiceDto["action"]) => void;
  onCancel: () => void;
};

// 渲染本地动作执行前的用户确认弹窗.
export function ConfirmDialog({
  action,
  onOnce,
  onAlways,
  onChoose,
  onChooseDefault,
  onCancel
}: ConfirmDialogProps) {
  if (!action) return null;

  const riskLabel = action.risk === "low" ? "低" : action.risk === "medium" ? "中" : "高";
  const choices = action.choices ?? [];

  return (
    <div className="dialog-backdrop">
      <section className="confirm-dialog">
        <h2>{action.title}</h2>
        <p>来源:{action.source}</p>
        {choices.length > 0 ? (
          <div className="choice-actions">
            {choices.map((choice) => (
              <div key={choice.id} className="choice-card">
                <button type="button" className="choice-open-button" onClick={() => onChoose(choice.action)}>
                  <span>{choice.title}</span>
                  {choice.subtitle && <small>{choice.subtitle}</small>}
                </button>
                <button
                  type="button"
                  className="choice-default-button"
                  onClick={() => onChooseDefault(choice.action)}
                >
                  将此设定为默认选项
                </button>
              </div>
            ))}
          </div>
        ) : (
          <>
            <p>风险:{riskLabel}</p>
            <div className="dialog-actions">
              <button type="button" onClick={onOnce}>
                仅这一次
              </button>
              <button type="button" onClick={onAlways}>
                以后不再询问
              </button>
            </div>
          </>
        )}
        <div className="dialog-actions">
          <button type="button" onClick={onCancel}>
            取消
          </button>
        </div>
      </section>
    </div>
  );
}
