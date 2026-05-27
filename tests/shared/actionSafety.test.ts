import { describe, expect, it } from "vitest";
import {
  buildActionImpactPreview,
  classifyRecoveryStrategy,
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
    expect(classifyRecoveryStrategy(action)).toEqual({
      level: "manual_review",
      label: "需要人工复核",
      message: "Shell 命令只允许只读 allowlist, 但执行结果无法自动撤销, 需要根据 stdout, stderr 和 exit code 人工复核."
    });
    expect(shouldOfferRememberedAuthorization(action)).toBe(false);
  });

  it("describes critical Windows automation with a stronger confirmation boundary", () => {
    const action = actionDto("keyboard_input", "active_window", "critical");

    expect(describeActionRisk(action)).toContain("关键风险");
    expect(shouldOfferRememberedAuthorization(action)).toBe(false);
    expect(describeActionImpact(action)).toEqual([
      "将向当前活动窗口发送键盘输入: active_window.",
      "这类动作可能影响任何当前聚焦的软件, 每次都必须单独确认."
    ]);
    expect(buildActionImpactPreview(action)).toEqual({
      title: "执行前影响预览",
      riskLabel: "关键风险",
      capability: "keyboard_input",
      target: "active_window",
      lines: [
        "将向当前活动窗口发送键盘输入: active_window.",
        "这类动作可能影响任何当前聚焦的软件, 每次都必须单独确认.",
        "恢复能力: 无法自动撤销."
      ]
    });
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
