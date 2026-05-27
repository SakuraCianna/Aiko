import { describe, expect, it } from "vitest";
import { validateShellCommandRequest } from "../../src/main/capabilities/shellCommand";

describe("validateShellCommandRequest", () => {
  it("allows simple PowerShell read-only commands", () => {
    expect(validateShellCommandRequest({ command: "Get-ChildItem -Name", timeoutMs: 1000 }).ok).toBe(true);
  });

  it("blocks destructive PowerShell commands", () => {
    expect(validateShellCommandRequest({ command: "Remove-Item -Recurse C:\\Temp" })).toEqual({
      ok: false,
      reason: "blocked_command"
    });
  });

  it("rejects empty and oversized commands", () => {
    expect(validateShellCommandRequest({ command: " " })).toEqual({ ok: false, reason: "invalid_command" });
    expect(validateShellCommandRequest({ command: "a".repeat(2001) })).toEqual({
      ok: false,
      reason: "invalid_command"
    });
  });
});
