import type { PendingActionChoiceDto, PendingActionDto } from "../../shared/ipcTypes";
import {
  describeActionImpact,
  describeActionRisk,
  describeRollbackStrategy,
  shouldOfferRememberedAuthorization
} from "../../shared/actionSafety";

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

  const choices = action.choices ?? [];
  const batchActions = action.actions ?? [];
  const showRememberButton = shouldOfferRememberedAuthorization(action);
  const impactLines = describeActionImpact(action);

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
            <div className="safety-panel">
              <p>{describeActionRisk(action)}</p>
              <ul className="safety-impact-list">
                {impactLines.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              <p className="rollback-note">{describeRollbackStrategy(action)}</p>
              {!showRememberButton && <p>高风险动作每次都要确认, 不会被记住为永久授权.</p>}
            </div>
            {batchActions.length > 0 && (
              <ol className="batch-action-list">
                {batchActions.map((batchAction, index) => (
                  <li key={`${batchAction.capability}-${batchAction.target}-${index}`}>
                    <span>{batchAction.title}</span>
                    <small>{batchAction.target}</small>
                  </li>
                ))}
              </ol>
            )}
            <div className="dialog-actions">
              <button type="button" onClick={onOnce}>
                仅这一次
              </button>
              {showRememberButton && (
                <button type="button" onClick={onAlways}>
                  以后不再询问
                </button>
              )}
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
