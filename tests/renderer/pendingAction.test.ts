import { describe, expect, it } from "vitest";
import { selectActionForCancellation } from "../../src/renderer/chat/pendingAction";
import type { PendingActionDto } from "../../src/shared/ipcTypes";

describe("selectActionForCancellation", () => {
  it("returns null when there is no pending action", () => {
    expect(selectActionForCancellation(null)).toBeNull();
  });

  it("keeps a normal pending action unchanged", () => {
    const action = pendingAction("open_application", "Cursor");

    expect(selectActionForCancellation(action)).toBe(action);
  });

  it("uses the first stored choice action when cancelling an application choice dialog", () => {
    const chrome = {
      ...pendingAction("open_application", "Google Chrome"),
      id: "choice-chrome",
      approval: { mode: "interrupt" as const, threadId: "approval-browser", status: "pending_action" as const }
    };
    const edge = {
      ...pendingAction("open_application", "Microsoft Edge"),
      id: "choice-edge",
      approval: { mode: "interrupt" as const, threadId: "approval-browser", status: "pending_action" as const }
    };
    const choiceGroup: PendingActionDto = {
      id: "choice-group",
      title: "选择要打开的应用",
      source: "打开浏览器",
      risk: "low",
      capability: "choose_application",
      target: "浏览器",
      choices: [
        { id: "choice-chrome", title: "Google Chrome", action: chrome },
        { id: "choice-edge", title: "Microsoft Edge", action: edge }
      ]
    };

    expect(selectActionForCancellation(choiceGroup)).toBe(chrome);
  });
});

function pendingAction(capability: string, target: string): PendingActionDto {
  return {
    title: `打开应用:${target}`,
    source: `打开 ${target}`,
    risk: "low",
    capability,
    target
  };
}
