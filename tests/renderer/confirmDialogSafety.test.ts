import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("ConfirmDialog safety copy", () => {
  it("shows risk and rollback copy before executing local actions", () => {
    const dialog = readFileSync("src/renderer/components/ConfirmDialog.tsx", "utf8");

    expect(dialog).toContain("describeActionRisk");
    expect(dialog).toContain("describeActionImpact");
    expect(dialog).toContain("describeRollbackStrategy");
    expect(dialog).toContain("showRememberButton");
    expect(dialog).toContain("高风险动作每次都要确认");
    expect(dialog).toContain("safety-impact-list");
    expect(dialog).toContain("rollback-note");
  });
});
