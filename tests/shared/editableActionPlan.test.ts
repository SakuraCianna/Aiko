import { describe, expect, it } from "vitest";
import {
  createEditedBatchAction,
  isSafeEditedBatchAction
} from "../../src/shared/editableActionPlan";
import type { PendingActionDto } from "../../src/shared/ipcTypes";

describe("editable action plan", () => {
  it("creates a batch action with only user-selected steps", () => {
    const action = batchAction([openAction("Chrome"), openAction("Cursor"), reminderAction()]);

    expect(createEditedBatchAction(action, [0, 2])).toEqual({
      ...action,
      actions: [openAction("Chrome"), reminderAction()]
    });
  });

  it("rejects empty or non-batch edited plans", () => {
    expect(createEditedBatchAction(openAction("Chrome"), [0])).toBeNull();
    expect(createEditedBatchAction(batchAction([openAction("Chrome")]), [])).toBeNull();
  });

  it("only accepts edited plans that remove original steps without modifying them", () => {
    const original = batchAction([openAction("Chrome"), openAction("Cursor"), reminderAction()]);
    const subset = createEditedBatchAction(original, [1, 2]);
    const modifiedTarget = {
      ...original,
      actions: [openAction("PowerShell")]
    };
    const reordered = {
      ...original,
      actions: [reminderAction(), openAction("Chrome")]
    };

    expect(subset && isSafeEditedBatchAction(original, subset)).toBe(true);
    expect(isSafeEditedBatchAction(original, modifiedTarget)).toBe(false);
    expect(isSafeEditedBatchAction(original, reordered)).toBe(false);
  });
});

function batchAction(actions: PendingActionDto[]): PendingActionDto {
  return {
    id: "batch-1",
    title: "批量操作",
    source: "test",
    risk: "medium",
    capability: "batch_actions",
    target: "batch",
    actions
  };
}

function openAction(target: string): PendingActionDto {
  return {
    title: `打开:${target}`,
    source: "test",
    risk: "low",
    capability: "open_application",
    target
  };
}

function reminderAction(): PendingActionDto {
  return {
    title: "提醒",
    source: "test",
    risk: "low",
    capability: "create_reminder",
    target: "喝水",
    params: { amount: 30, unit: "minutes", title: "喝水" }
  };
}
