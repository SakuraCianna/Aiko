import { describe, expect, test } from "vitest";
import type { PendingActionDto } from "./ipcTypes";
import { createEditedBatchAction, isSafeEditedBatchAction } from "./editableActionPlan";

const firstAction: PendingActionDto = {
  id: "open-docs",
  title: "打开文档",
  source: "打开文档",
  risk: "low",
  capability: "open_url",
  target: "https://example.com/docs"
};

const secondAction: PendingActionDto = {
  id: "open-app",
  title: "打开记事本",
  source: "打开记事本",
  risk: "low",
  capability: "open_application",
  target: "notepad"
};

const batchAction: PendingActionDto = {
  id: "batch-1",
  title: "执行 2 个操作",
  source: "打开文档和记事本",
  risk: "low",
  capability: "batch_actions",
  target: "batch",
  actions: [firstAction, secondAction]
};

describe("editable batch actions", () => {
  test("creates a deduplicated subset while preserving original order", () => {
    const edited = createEditedBatchAction(batchAction, [1, 1, 0]);

    expect(edited?.actions).toEqual([firstAction, secondAction]);
  });

  test("accepts removing steps from the original batch plan", () => {
    const edited = createEditedBatchAction(batchAction, [1]);

    expect(edited).not.toBeNull();
    expect(isSafeEditedBatchAction(batchAction, edited as PendingActionDto)).toBe(true);
  });

  test("rejects rewritten child action targets", () => {
    const edited: PendingActionDto = {
      ...batchAction,
      actions: [{ ...firstAction, target: "https://malicious.example" }]
    };

    expect(isSafeEditedBatchAction(batchAction, edited)).toBe(false);
  });
});
