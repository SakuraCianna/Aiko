import { describe, expect, it } from "vitest";
import { createAikoActionJournal } from "../../src/main/agent/runtime/actionJournal";
import type { PendingActionDto } from "../../src/shared/ipcTypes";

describe("createAikoActionJournal", () => {
  it("records planned actions, approval decisions, and execution results", () => {
    const journal = createAikoActionJournal({
      idFactory: (() => {
        let index = 0;
        return () => `journal_${++index}`;
      })(),
      now: () => new Date("2026-05-24T10:00:00.000Z")
    });
    const action = openApplicationAction();

    journal.recordPlanned({ runId: "run_1", action, source: "planner" });
    journal.recordApproval({ action, decision: "approved", reason: "user_confirmed" });
    journal.recordExecutionResult({ action, ok: true, message: "opened" });

    expect(journal.list()).toEqual([
      expect.objectContaining({
        id: "journal_1",
        runId: "run_1",
        actionId: "action_1",
        phase: "planned",
        capability: "open_application",
        target: "Cursor",
        source: "planner"
      }),
      expect.objectContaining({
        id: "journal_2",
        actionId: "action_1",
        phase: "approval",
        decision: "approved",
        message: "user_confirmed"
      }),
      expect.objectContaining({
        id: "journal_3",
        actionId: "action_1",
        phase: "execution",
        ok: true,
        message: "opened"
      })
    ]);
  });

  it("keeps only the configured number of recent entries", () => {
    const journal = createAikoActionJournal({ maxRecords: 2 });
    journal.recordPlanned({ action: openApplicationAction("A"), source: "planner" });
    journal.recordPlanned({ action: openApplicationAction("B"), source: "planner" });
    journal.recordPlanned({ action: openApplicationAction("C"), source: "planner" });

    expect(journal.list().map((entry) => entry.target)).toEqual(["B", "C"]);
  });

  it("mirrors entries into a persistent store when configured", () => {
    const stored: unknown[] = [];
    const journal = createAikoActionJournal({
      idFactory: () => "journal_1",
      now: () => new Date("2026-05-24T10:00:00.000Z"),
      store: {
        recordActionJournalEntry(entry) {
          stored.push(entry);
        },
        listActionJournal() {
          return stored as ReturnType<typeof journal.list>;
        }
      }
    });

    journal.recordExecutionResult({ action: openApplicationAction(), ok: true, message: "opened" });

    expect(stored).toEqual([
      expect.objectContaining({
        id: "journal_1",
        phase: "execution",
        actionId: "action_1",
        ok: true,
        message: "opened"
      })
    ]);
  });
});

function openApplicationAction(target = "Cursor"): PendingActionDto {
  return {
    id: "action_1",
    title: `Open ${target}`,
    source: target,
    risk: "low",
    capability: "open_application",
    target
  };
}
