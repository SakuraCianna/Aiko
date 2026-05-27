import { describe, expect, it } from "vitest";
import {
  describeActionRisk,
  describeRollbackStrategy,
  shouldOfferRememberedAuthorization
} from "../../src/shared/actionSafety";
import type { PendingActionDto } from "../../src/shared/ipcTypes";

describe("actionSafety", () => {
  it("describes high-risk shell actions with rollback limits", () => {
    const action = actionDto("run_shell_command", "Get-ChildItem", "high");

    expect(describeActionRisk(action)).toContain("高风险");
    expect(describeRollbackStrategy(action)).toContain("Shell");
    expect(shouldOfferRememberedAuthorization(action)).toBe(false);
  });

  it("only offers remembered authorization for low-risk actions", () => {
    expect(shouldOfferRememberedAuthorization(actionDto("open_url", "https://example.com", "low"))).toBe(true);
    expect(shouldOfferRememberedAuthorization(actionDto("write_file", "C:\\Aiko\\note.md", "medium"))).toBe(false);
    expect(shouldOfferRememberedAuthorization(actionDto("delete_file", "C:\\Aiko\\note.md", "high"))).toBe(false);
  });
});

function actionDto(capability: string, target: string, risk: PendingActionDto["risk"]): PendingActionDto {
  return {
    title: "Action",
    source: "test",
    risk,
    capability,
    target
  };
}
