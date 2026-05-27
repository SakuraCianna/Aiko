import type { PendingActionDto } from "./ipcTypes";

// 从批量动作里按用户选择生成删减后的执行计划.
export function createEditedBatchAction(action: PendingActionDto, selectedIndexes: number[]): PendingActionDto | null {
  if (action.capability !== "batch_actions" || !action.actions?.length) return null;
  const selected = uniqueSortedIndexes(selectedIndexes)
    .map((index) => action.actions?.[index])
    .filter((candidate): candidate is PendingActionDto => Boolean(candidate));
  if (selected.length === 0) return null;
  return {
    ...action,
    actions: selected
  };
}

// 主进程只接受从原始批量计划中删除步骤, 不接受修改, 新增或重排步骤.
export function isSafeEditedBatchAction(original: PendingActionDto, candidate: PendingActionDto): boolean {
  if (original.capability !== "batch_actions" || candidate.capability !== "batch_actions") return false;
  if (!original.id || original.id !== candidate.id) return false;
  if (!sameBatchEnvelope(original, candidate)) return false;
  const originalActions = original.actions ?? [];
  const candidateActions = candidate.actions ?? [];
  if (candidateActions.length === 0 || candidateActions.length > originalActions.length) return false;

  let cursor = 0;
  for (const candidateAction of candidateActions) {
    const index = originalActions.findIndex((originalAction, originalIndex) => {
      return originalIndex >= cursor && sameActionShape(originalAction, candidateAction);
    });
    if (index < cursor) return false;
    cursor = index + 1;
  }
  return true;
}

// 去重并排序索引, 确保执行顺序仍然遵循原计划.
function uniqueSortedIndexes(indexes: number[]) {
  return [...new Set(indexes.filter((index) => Number.isInteger(index) && index >= 0))].sort((left, right) => left - right);
}

// 比较批量动作外壳, 保证用户编辑只发生在 actions 列表.
function sameBatchEnvelope(left: PendingActionDto, right: PendingActionDto) {
  return (
    left.id === right.id &&
    left.title === right.title &&
    left.source === right.source &&
    left.risk === right.risk &&
    left.target === right.target &&
    JSON.stringify(left.params ?? {}) === JSON.stringify(right.params ?? {}) &&
    JSON.stringify(left.approval ?? {}) === JSON.stringify(right.approval ?? {})
  );
}

// 比较子动作本身, 防止把删除步骤伪装成修改目标或能力.
function sameActionShape(left: PendingActionDto, right: PendingActionDto) {
  return (
    left.id === right.id &&
    left.title === right.title &&
    left.source === right.source &&
    left.risk === right.risk &&
    left.capability === right.capability &&
    left.target === right.target &&
    JSON.stringify(left.params ?? {}) === JSON.stringify(right.params ?? {}) &&
    JSON.stringify(left.approval ?? {}) === JSON.stringify(right.approval ?? {}) &&
    JSON.stringify(left.choices ?? []) === JSON.stringify(right.choices ?? []) &&
    JSON.stringify(left.actions ?? []) === JSON.stringify(right.actions ?? [])
  );
}
