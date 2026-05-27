import { describe, expect, it } from "vitest";
import { validateShellCommandRequest } from "../../src/main/capabilities/shellCommand";

describe("validateShellCommandRequest", () => {
  it("allows simple PowerShell read-only commands", () => {
    expect(validateShellCommandRequest({ command: "Get-ChildItem -Name", timeoutMs: 1000 }).ok).toBe(true);
    expect(validateShellCommandRequest({ command: "Get-Process -Name node" }).ok).toBe(true);
    expect(validateShellCommandRequest({ command: "get-process -Name node" }).ok).toBe(true);
    expect(validateShellCommandRequest({ command: "Test-Path E:\\CodeHome\\Aiko" }).ok).toBe(true);
  });

  it("blocks destructive PowerShell commands", () => {
    expect(validateShellCommandRequest({ command: "Remove-Item -Recurse C:\\Temp" })).toEqual({
      ok: false,
      reason: "blocked_command"
    });
  });

  it("rejects commands outside the read-only allowlist", () => {
    expect(validateShellCommandRequest({ command: "Set-Content note.txt hi" })).toEqual({
      ok: false,
      reason: "not_allowlisted"
    });
    expect(validateShellCommandRequest({ command: "Start-Process calc.exe" })).toEqual({
      ok: false,
      reason: "not_allowlisted"
    });
    expect(validateShellCommandRequest({ command: "cmd /c dir" })).toEqual({
      ok: false,
      reason: "not_allowlisted"
    });
    expect(validateShellCommandRequest({ command: "dir" })).toEqual({
      ok: false,
      reason: "not_allowlisted"
    });
  });

  it("rejects command chaining, pipes, redirects and sensitive file targets", () => {
    expect(validateShellCommandRequest({ command: "Get-ChildItem; Get-Process" })).toEqual({
      ok: false,
      reason: "blocked_command"
    });
    expect(validateShellCommandRequest({ command: "Get-ChildItem | Select-Object -First 1" })).toEqual({
      ok: false,
      reason: "blocked_command"
    });
    expect(validateShellCommandRequest({ command: "Get-ChildItem > out.txt" })).toEqual({
      ok: false,
      reason: "blocked_command"
    });
    expect(validateShellCommandRequest({ command: "Get-ChildItem .env" })).toEqual({
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
