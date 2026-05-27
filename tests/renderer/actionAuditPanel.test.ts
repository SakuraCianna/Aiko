import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildRestoreHistory,
  createRestoreActionFromAuditEntry,
  extractAuditArtifacts,
  extractShellCommandOutput,
  extractTrashPathFromAuditMessage,
  filterAuditEntries,
  filterRestoreHistory
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
    expect(styles).toContain(".audit-restore-history");
    expect(styles).toContain(".audit-shell-artifact");
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
    expect(panel).toContain("restoreStatusFilter");
    expect(panel).toContain("restoreSearchText");
    expect(panel).toContain("准备恢复");
    expect(panel).toContain("恢复历史");
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

    const shellEntry = makeEntry({
      phase: "execution",
      capability: "run_shell_command",
      risk: "high",
      ok: false,
      message: "Shell command finished with exit code 1.\nstdout:\nDesktop\nDocuments\nstderr:\nAccess denied"
    });

    expect(extractShellCommandOutput(shellEntry.message)).toEqual({
      exitCode: "1",
      stdout: "Desktop\nDocuments",
      stderr: "Access denied",
      noOutput: false,
      timedOut: false
    });
    expect(extractAuditArtifacts(shellEntry)).toEqual([
      { label: "退出码", value: "1", tone: "failed" },
      { label: "标准输出", value: "Desktop\nDocuments", tone: "neutral" },
      { label: "错误输出", value: "Access denied", tone: "failed" }
    ]);
  });

  it("builds restore history and disables restore actions after a file is restored", () => {
    const deleteEntry = makeEntry({
      id: "delete-1",
      phase: "execution",
      actionId: "delete-action",
      capability: "delete_file",
      risk: "high",
      target: "C:\\Users\\Sakura\\Desktop\\old.md",
      ok: true,
      message: "File moved to Aiko trash: C:\\Users\\Sakura\\AppData\\Roaming\\Aiko\\trash\\old.md",
      createdAt: "2026-05-27T09:00:00.000Z"
    });
    const restoredDeleteEntry = makeEntry({
      id: "delete-2",
      phase: "execution",
      actionId: "delete-action-2",
      capability: "delete_file",
      risk: "high",
      target: "C:\\Users\\Sakura\\Desktop\\done.md",
      ok: true,
      message: "File moved to Aiko trash: C:\\Users\\Sakura\\AppData\\Roaming\\Aiko\\trash\\done.md",
      createdAt: "2026-05-27T09:10:00.000Z"
    });
    const restoreEntry = makeEntry({
      id: "restore-1",
      phase: "execution",
      actionId: "restore-action",
      capability: "restore_file_from_trash",
      risk: "high",
      target: "C:\\Users\\Sakura\\AppData\\Roaming\\Aiko\\trash\\done.md",
      ok: true,
      message: "File restored from Aiko trash: C:\\Users\\Sakura\\Desktop\\done.md",
      createdAt: "2026-05-27T09:15:00.000Z"
    });

    expect(buildRestoreHistory([deleteEntry, restoredDeleteEntry, restoreEntry])).toEqual([
      {
        id: "delete-2",
        originalPath: "C:\\Users\\Sakura\\Desktop\\done.md",
        trashPath: "C:\\Users\\Sakura\\AppData\\Roaming\\Aiko\\trash\\done.md",
        deletedAt: "2026-05-27T09:10:00.000Z",
        restoredAt: "2026-05-27T09:15:00.000Z",
        restoredPath: "C:\\Users\\Sakura\\Desktop\\done.md",
        status: "restored"
      },
      {
        id: "delete-1",
        originalPath: "C:\\Users\\Sakura\\Desktop\\old.md",
        trashPath: "C:\\Users\\Sakura\\AppData\\Roaming\\Aiko\\trash\\old.md",
        deletedAt: "2026-05-27T09:00:00.000Z",
        status: "in_trash",
        restoreAction: {
          title: "恢复文件:C:\\Users\\Sakura\\AppData\\Roaming\\Aiko\\trash\\old.md",
          source: "动作审计",
          risk: "high",
          capability: "restore_file_from_trash",
          target: "C:\\Users\\Sakura\\AppData\\Roaming\\Aiko\\trash\\old.md",
          params: {
            destinationPath: "C:\\Users\\Sakura\\Desktop\\old.md"
          }
        }
      }
    ]);
  });

  it("filters restore history by file name and restore status", () => {
    const items = [
      {
        id: "old",
        originalPath: "C:\\Users\\Sakura\\Desktop\\old.md",
        trashPath: "C:\\Aiko\\.trash\\old.md",
        deletedAt: "2026-05-27T09:00:00.000Z",
        status: "in_trash" as const
      },
      {
        id: "done",
        originalPath: "C:\\Users\\Sakura\\Desktop\\done.md",
        trashPath: "C:\\Aiko\\.trash\\done.md",
        restoredPath: "C:\\Users\\Sakura\\Desktop\\done.md",
        restoredAt: "2026-05-27T09:15:00.000Z",
        status: "restored" as const
      }
    ];

    expect(filterRestoreHistory(items, { status: "in_trash", searchText: "" }).map((item) => item.id)).toEqual(["old"]);
    expect(filterRestoreHistory(items, { status: "all", searchText: "done.md" }).map((item) => item.id)).toEqual(["done"]);
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
