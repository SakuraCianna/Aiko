import { describe, expect, test } from "vitest";
import { validateShellCommandRequest } from "./shellCommand";

describe("validateShellCommandRequest", () => {
  test("allows a single read-only PowerShell command", () => {
    const result = validateShellCommandRequest({
      command: "Get-ChildItem",
      cwd: "E:\\CodeHome\\Aiko"
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.request.command).toBe("Get-ChildItem");
      expect(result.request.timeoutMs).toBe(10000);
      expect(result.request.outputLimit).toBe(12000);
    }
  });

  test("blocks destructive commands before execution", () => {
    const result = validateShellCommandRequest({
      command: "Remove-Item .\\out -Recurse"
    });

    expect(result).toEqual({ ok: false, reason: "blocked_command" });
  });

  test("blocks shell chaining and pipeline syntax", () => {
    const result = validateShellCommandRequest({
      command: "Get-ChildItem | Select-Object Name"
    });

    expect(result).toEqual({ ok: false, reason: "blocked_command" });
  });

  test("blocks sensitive environment files", () => {
    const result = validateShellCommandRequest({
      command: "Get-Item .env"
    });

    expect(result).toEqual({ ok: false, reason: "blocked_command" });
  });
});
