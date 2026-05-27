import { describe, expect, it } from "vitest";
import {
  describeActionImpact,
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

  it("describes capability-specific impact before high-risk actions run", () => {
    expect(describeActionImpact(actionDto("run_shell_command", "Get-ChildItem", "high"))).toEqual([
      "将执行受控 PowerShell 只读命令: Get-ChildItem.",
      "执行后会记录 exit code, stdout 和 stderr, 但不会保证自动撤销."
    ]);
    expect(describeActionImpact(actionDto("delete_file", "C:\\Aiko\\note.md", "high"))).toEqual([
      "将把目标文件移动到 Aiko trash: C:\\Aiko\\note.md.",
      "不会直接永久删除, 后续可从动作审计里准备恢复."
    ]);
    expect(
      describeActionImpact({
        ...actionDto("restore_file_from_trash", "C:\\Aiko\\trash\\note.md", "high"),
        params: { destinationPath: "C:\\Aiko\\note.md" }
      })
    ).toEqual([
      "将从 Aiko trash 恢复文件: C:\\Aiko\\trash\\note.md.",
      "目标路径: C:\\Aiko\\note.md. 如果目标已存在, 执行器会停止恢复."
    ]);
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
