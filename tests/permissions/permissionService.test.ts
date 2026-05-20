import { describe, expect, it } from "vitest";
import { createPermissionService } from "../../src/main/permissions/permissionService";

describe("permissionService", () => {
  it("requires confirmation for first low-risk action", () => {
    const service = createPermissionService([]);
    expect(service.canExecute({ capability: "open_application", target: "VS Code", risk: "low" })).toEqual({
      allowed: false,
      reason: "confirmation_required"
    });
  });

  it("allows an action after remember authorization", () => {
    const service = createPermissionService([]);
    service.remember({ capability: "open_application", target: "VS Code", risk: "low" });

    expect(service.canExecute({ capability: "open_application", target: "VS Code", risk: "low" })).toEqual({
      allowed: true,
      reason: "remembered"
    });
  });

  it("blocks high-risk actions in the first version", () => {
    const service = createPermissionService([]);
    expect(service.canExecute({ capability: "shell_command", target: "Remove-Item", risk: "high" })).toEqual({
      allowed: false,
      reason: "unsupported_high_risk"
    });
  });
});
