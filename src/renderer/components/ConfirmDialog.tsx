import { useEffect, useMemo, useState } from "react";
import type { PendingActionChoiceDto, PendingActionDto } from "../../shared/ipcTypes";
import {
  buildActionImpactPreview,
  describeActionImpact,
  describeActionRisk,
  describeRollbackStrategy,
  shouldOfferRememberedAuthorization
} from "../../shared/actionSafety";
import { createEditedBatchAction } from "../../shared/editableActionPlan";

type ConfirmDialogProps = {
  action: PendingActionDto | null;
  onOnce: (action?: PendingActionDto) => void;
  onAlways: (action?: PendingActionDto) => void;
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
  const [selectedBatchIndexes, setSelectedBatchIndexes] = useState<number[]>([]);

  useEffect(() => {
    setSelectedBatchIndexes(action?.actions?.map((_, index) => index) ?? []);
  }, [action?.id, action?.actions]);

  const choices = action?.choices ?? [];
  const batchActions = action?.actions ?? [];
  const editedAction = useMemo(
    () => (action && batchActions.length > 0 ? createEditedBatchAction(action, selectedBatchIndexes) : action),
    [action, batchActions.length, selectedBatchIndexes]
  );

  if (!action) return null;

  const showRememberButton = shouldOfferRememberedAuthorization(action);
  const impactLines = describeActionImpact(action);
  const impactPreview = buildActionImpactPreview(action);
  const canExecuteEditedAction = batchActions.length === 0 || Boolean(editedAction);

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
              <div className="safety-impact-preview" aria-label="执行前影响预览">
                <strong>{impactPreview.title}</strong>
                <dl>
                  <dt>风险</dt>
                  <dd>{impactPreview.riskLabel}</dd>
                  <dt>能力</dt>
                  <dd>{impactPreview.capability}</dd>
                  <dt>目标</dt>
                  <dd>{impactPreview.target}</dd>
                </dl>
              </div>
              <p className="rollback-note">{describeRollbackStrategy(action)}</p>
              {!showRememberButton && <p>高风险动作每次都要确认, 不会被记住为永久授权.</p>}
            </div>
            {batchActions.length > 0 && (
              <ol className="batch-action-list">
                {batchActions.map((batchAction, index) => (
                  <li key={`${batchAction.capability}-${batchAction.target}-${index}`}>
                    <label>
                      <input
                        type="checkbox"
                        checked={selectedBatchIndexes.includes(index)}
                        onChange={() => setSelectedBatchIndexes((current) => toggleBatchIndex(current, index))}
                      />
                      <span>{batchAction.title}</span>
                    </label>
                    <small>{batchAction.target}</small>
                  </li>
                ))}
              </ol>
            )}
            <div className="dialog-actions">
              <button type="button" disabled={!canExecuteEditedAction} onClick={() => editedAction && onOnce(editedAction)}>
                仅这一次
              </button>
              {showRememberButton && (
                <button type="button" disabled={!canExecuteEditedAction} onClick={() => editedAction && onAlways(editedAction)}>
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

// 切换批量计划中的单个步骤, 用户只能删减步骤, 不能改写步骤内容.
function toggleBatchIndex(current: number[], index: number) {
  return current.includes(index) ? current.filter((value) => value !== index) : [...current, index].sort((left, right) => left - right);
}
