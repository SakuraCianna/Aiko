import type { PendingActionDto } from "../../shared/ipcTypes";

// 选择真正需要发给主进程取消的动作.
export function selectActionForCancellation(action: PendingActionDto | null): PendingActionDto | null {
  if (!action) return null;
  if (action.capability !== "choose_application") return action;
  return action.choices?.[0]?.action ?? null;
}
