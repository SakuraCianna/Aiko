import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("ActionAuditPanel", () => {
  it("is reachable from the panel shell and renders action journal safety details", () => {
    const app = readFileSync("src/renderer/App.tsx", "utf8");
    const panelShell = readFileSync("src/renderer/components/PanelShell.tsx", "utf8");
    const sharedTypes = readFileSync("src/shared/ipcTypes.ts", "utf8");
    const styles = readFileSync("src/renderer/styles.css", "utf8");

    expect(existsSync("src/renderer/components/ActionAuditPanel.tsx")).toBe(true);
    expect(sharedTypes).toContain("\"audit\"");
    expect(app).toContain("ActionAuditPanel");
    expect(app).toContain("activePanel === \"audit\"");
    expect(panelShell).toContain("{ id: \"audit\", label: \"审计\" }");
    expect(styles).toContain(".audit-log-list");
  });

  it("loads action journal entries and shows rollback strategy", () => {
    const panel = readFileSync("src/renderer/components/ActionAuditPanel.tsx", "utf8");

    expect(panel).toContain("window.aiko.getAgentDebugSnapshot");
    expect(panel).toContain("snapshot.actionJournal");
    expect(panel).toContain("describeRollbackStrategy");
    expect(panel).toContain("describeActionRisk");
    expect(panel).toContain("refreshSeqRef.current === refreshId");
  });
});
