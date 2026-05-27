import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("dead code cleanup", () => {
  it("removes the old IPC local action policy shim", () => {
    const handlers = readFileSync("src/main/ipc/handlers.ts", "utf8");

    expect(existsSync("src/main/ipc/localActionPolicy.ts")).toBe(false);
    expect(handlers).toContain("../actions/localActionTrust");
    expect(handlers).not.toContain("./localActionPolicy");
  });

  it("removes the unused Markdown reply renderer after the voice-first UI migration", () => {
    const styles = readFileSync("src/renderer/styles.css", "utf8");

    expect(existsSync("src/renderer/components/MarkdownMessage.tsx")).toBe(false);
    expect(styles).not.toContain("pet-reply");
    expect(styles).not.toContain("markdown-message");
  });

  it("removes unused helper exports from retired planning paths", () => {
    const chatPayload = readFileSync("src/shared/chatPayload.ts", "utf8");
    const reminderService = readFileSync("src/main/reminders/reminderService.ts", "utf8");
    const mcpToolProvider = readFileSync("src/main/agent/mcp/mcpToolProvider.ts", "utf8");
    const capabilityTypes = readFileSync("src/main/capabilities/capabilityTypes.ts", "utf8");

    expect(chatPayload).not.toContain("export function isAudioMimeType");
    expect(reminderService).not.toContain("export function findDueReminders");
    expect(mcpToolProvider).not.toContain("export async function loadMcpTools");
    expect(capabilityTypes).not.toContain("export type CapabilityName");
  });

  it("removes stale Superpowers implementation drafts that predate the VRM and LangGraph baseline", () => {
    expect(existsSync("docs/superpowers/specs/2026-05-19-aiko-desktop-pet-design.md")).toBe(false);
    expect(existsSync("docs/superpowers/plans/2026-05-21-agent-layer-split.md")).toBe(false);
    expect(existsSync("docs/superpowers/plans/2026-05-24-langgraph-runtime-workflow.md")).toBe(false);
  });

  it("removes legacy Tavily single-key configuration from user-facing config", () => {
    const env = readFileSync(".env.example", "utf8");
    const envParser = readFileSync("src/main/config/env.ts", "utf8");

    expect(env).not.toContain("TAVILY_API_KEY=");
    expect(env).toContain("TAVILY_API_KEYS=");
    expect(envParser).not.toContain("readOptional(env, \"TAVILY_API_KEY\")");
  });
});
