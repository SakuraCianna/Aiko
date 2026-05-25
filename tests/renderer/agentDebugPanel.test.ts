import { readFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("AgentDebugPanel", () => {
  it("is reachable from the panel shell and reads the agent debug snapshot", () => {
    const app = readFileSync("src/renderer/App.tsx", "utf8");
    const panelShell = readFileSync("src/renderer/components/PanelShell.tsx", "utf8");
    const preload = readFileSync("src/main/preload.ts", "utf8");
    const sharedTypes = readFileSync("src/shared/ipcTypes.ts", "utf8");
    const styles = readFileSync("src/renderer/styles.css", "utf8");

    expect(existsSync("src/renderer/components/AgentDebugPanel.tsx")).toBe(true);
    expect(app).toContain("AgentDebugPanel");
    expect(app).toContain("activePanel === \"agent\"");
    expect(panelShell).toContain("{ id: \"agent\", label: \"Agent\" }");
    expect(preload).toContain("agent:debug-snapshot");
    expect(sharedTypes).toContain("AikoAgentDebugSnapshotDto");
    expect(styles).toContain(".agent-debug-grid");
    expect(sharedTypes).toContain("AikoAgentStatusEventDto");
  });

  it("keeps async refreshes guarded after unmount and stale requests", () => {
    const panel = readFileSync("src/renderer/components/AgentDebugPanel.tsx", "utf8");

    expect(panel).toContain("window.aiko.getAgentDebugSnapshot");
    expect(panel).toContain("mountedRef");
    expect(panel).toContain("refreshSeqRef");
    expect(panel).toContain("refreshSeqRef.current === refreshId");
    expect(panel).toContain("model_generate.completed");
    expect(panel).toContain("approval_resume");
    expect(panel).toContain("snapshot.statuses");
    expect(panel).toContain("Agent 状态时间线");
  });
});
