import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  createRestoreActionFromAuditEntry,
  extractAuditArtifacts,
  extractTrashPathFromAuditMessage,
  filterAuditEntries
} from "../../src/renderer/components/actionAuditHelpers";
import type { AikoActionJournalEntryDto } from "../../src/shared/ipcTypes";

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
    expect(app).toContain("onProposeAction");
    expect(panelShell).toContain("{ id: \"audit\", label: \"审计\" }");
    expect(styles).toContain(".audit-log-list");
    expect(styles).toContain(".audit-filter-bar");
  });

  it("loads action journal entries and shows rollback strategy", () => {
    const panel = readFileSync("src/renderer/components/ActionAuditPanel.tsx", "utf8");

    expect(panel).toContain("window.aiko.getAgentDebugSnapshot");
    expect(panel).toContain("snapshot.actionJournal");
    expect(panel).toContain("describeRollbackStrategy");
    expect(panel).toContain("describeActionRisk");
    expect(panel).toContain("refreshSeqRef.current === refreshId");
    expect(panel).toContain("riskFilter");
    expect(panel).toContain("capabilityFilter");
    expect(panel).toContain("resultFilter");
    expect(panel).toContain("searchText");
    expect(panel).toContain("准备恢复");
    expect(readFileSync("src/renderer/components/actionAuditHelpers.ts", "utf8")).toContain("restore_file_from_trash");
  });

  it("filters audit entries by risk, capability, result and text", () => {
    const entries = [
      makeEntry({
        id: "planned-open",
        phase: "planned",
        capability: "open_application",
        risk: "low",
        target: "Cursor"
      }),
      makeEntry({
        id: "failed-shell",
        phase: "execution",
        capability: "run_shell_command",
        risk: "high",
        target: "Get-ChildItem",
        ok: false,
        message: "Command rejected"
      }),
      makeEntry({
        id: "ok-delete",
        phase: "execution",
        capability: "delete_file",
        risk: "high",
        target: "C:\\Users\\Sakura\\Desktop\\old.md",
        ok: true,
        message: "File moved to Aiko trash: C:\\Users\\Sakura\\AppData\\Roaming\\Aiko\\trash\\old.md"
      })
    ];

    expect(
      filterAuditEntries(entries, {
        risk: "high",
        capability: "all",
        result: "all",
        searchText: ""
      }).map((entry) => entry.id)
    ).toEqual(["failed-shell", "ok-delete"]);

    expect(
      filterAuditEntries(entries, {
        risk: "all",
        capability: "run_shell_command",
        result: "failed",
        searchText: "rejected"
      }).map((entry) => entry.id)
    ).toEqual(["failed-shell"]);

    expect(
      filterAuditEntries(entries, {
        risk: "all",
        capability: "all",
        result: "ok",
        searchText: "trash"
      }).map((entry) => entry.id)
    ).toEqual(["ok-delete"]);
  });

  it("creates a high-risk restore action from a successful delete audit entry", () => {
    const entry = makeEntry({
      phase: "execution",
      capability: "delete_file",
      risk: "high",
      target: "C:\\Users\\Sakura\\Desktop\\old.md",
      ok: true,
      message: "File moved to Aiko trash: C:\\Users\\Sakura\\AppData\\Roaming\\Aiko\\trash\\old.md"
    });

    expect(extractTrashPathFromAuditMessage(entry.message)).toBe("C:\\Users\\Sakura\\AppData\\Roaming\\Aiko\\trash\\old.md");
    expect(createRestoreActionFromAuditEntry(entry)).toEqual({
      title: "恢复文件:C:\\Users\\Sakura\\AppData\\Roaming\\Aiko\\trash\\old.md",
      source: "动作审计",
      risk: "high",
      capability: "restore_file_from_trash",
      target: "C:\\Users\\Sakura\\AppData\\Roaming\\Aiko\\trash\\old.md",
      params: {
        destinationPath: "C:\\Users\\Sakura\\Desktop\\old.md"
      }
    });
  });

  it("extracts file and shell artifacts from audit messages", () => {
    expect(
      extractAuditArtifacts(
        makeEntry({
          phase: "execution",
          capability: "write_file",
          risk: "high",
          ok: true,
          message: "File written. Backup saved: C:\\Users\\Sakura\\AppData\\Roaming\\Aiko\\backups\\note.md"
        })
      )
    ).toEqual([{ label: "备份路径", value: "C:\\Users\\Sakura\\AppData\\Roaming\\Aiko\\backups\\note.md" }]);

    expect(
      extractAuditArtifacts(
        makeEntry({
          phase: "execution",
          capability: "delete_file",
          risk: "high",
          ok: true,
          message: "File moved to Aiko trash: C:\\Users\\Sakura\\AppData\\Roaming\\Aiko\\trash\\note.md"
        })
      )
    ).toEqual([{ label: "隔离路径", value: "C:\\Users\\Sakura\\AppData\\Roaming\\Aiko\\trash\\note.md" }]);

    expect(
      extractAuditArtifacts(
        makeEntry({
          phase: "execution",
          capability: "run_shell_command",
          risk: "high",
          ok: true,
          message: "Exit code: 0\nDesktop\nDocuments"
        })
      )
    ).toEqual([{ label: "Shell 输出", value: "Exit code: 0\nDesktop\nDocuments" }]);
  });
});

function makeEntry(overrides: Partial<AikoActionJournalEntryDto> = {}): AikoActionJournalEntryDto {
  return {
    id: "entry-1",
    phase: "planned",
    actionId: "action-1",
    capability: "open_application",
    target: "target",
    risk: "low",
    createdAt: "2026-05-27T00:00:00.000Z",
    ...overrides
  };
}
