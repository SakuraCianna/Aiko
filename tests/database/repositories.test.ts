import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { runMigrations } from "../../src/main/database/migrations";
import {
  createApplicationPreferenceRepository,
  createAuditRepository,
  createMemoryRepository,
  createPermissionRepository,
  createReminderRepository
} from "../../src/main/database/repositories";

const require = createRequire(import.meta.url);

function createMemoryDatabase() {
  const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
  const db = new DatabaseSync(":memory:");
  runMigrations(db);
  return db;
}

describe("database repositories", () => {
  it("persists action journal entries for audit history", () => {
    const db = createMemoryDatabase();
    const repository = createAuditRepository(db);

    repository.recordActionJournalEntry({
      id: "journal_1",
      phase: "execution",
      actionId: "action_1",
      runId: "run_1",
      capability: "open_application",
      target: "Cursor",
      risk: "low",
      ok: true,
      message: "opened",
      createdAt: "2026-05-24T10:00:00.000Z"
    });

    expect(createAuditRepository(db).listActionJournal()).toEqual([
      {
        id: "journal_1",
        phase: "execution",
        actionId: "action_1",
        runId: "run_1",
        capability: "open_application",
        target: "Cursor",
        risk: "low",
        ok: true,
        message: "opened",
        createdAt: "2026-05-24T10:00:00.000Z"
      }
    ]);

    db.close();
  });

  it("persists agent traces and events for audit history", () => {
    const db = createMemoryDatabase();
    const repository = createAuditRepository(db);

    repository.startTrace({
      requestId: "request_1",
      startedAt: "2026-05-24T10:00:00.000Z"
    });
    repository.addTraceEvent("request_1", {
      name: "planner.completed",
      at: "2026-05-24T10:00:01.000Z",
      data: { mode: "chat" }
    });
    repository.endTrace("request_1", "2026-05-24T10:00:02.000Z");

    expect(createAuditRepository(db).listTraces()).toEqual([
      {
        requestId: "request_1",
        startedAt: "2026-05-24T10:00:00.000Z",
        endedAt: "2026-05-24T10:00:02.000Z",
        events: [
          {
            name: "planner.completed",
            at: "2026-05-24T10:00:01.000Z",
            data: { mode: "chat" }
          }
        ]
      }
    ]);

    db.close();
  });

  it("persists remembered permission rules case-insensitively", () => {
    const db = createMemoryDatabase();
    const repository = createPermissionRepository(db);

    repository.remember({
      capability: "open_application",
      target: "Chrome",
      risk: "low"
    });

    expect(repository.list()).toEqual([
      {
        capability: "open_application",
        target: "chrome",
        risk: "low"
      }
    ]);
    expect(
      repository.has({
        capability: "open_application",
        target: "CHROME"
      })
    ).toBe(true);

    db.close();
  });

  it("does not persist medium-risk permission rules", () => {
    const db = createMemoryDatabase();
    const repository = createPermissionRepository(db);

    repository.remember({
      capability: "write_desktop_markdown",
      target: "Desktop/Aiko",
      risk: "medium"
    });

    expect(repository.list()).toEqual([]);
    expect(repository.has({ capability: "write_desktop_markdown", target: "Desktop/Aiko" })).toBe(false);

    db.close();
  });

  it("persists default application preferences in settings", () => {
    const db = createMemoryDatabase();
    const repository = createApplicationPreferenceRepository(db);

    repository.setDefaultApplication("浏览器", "Google Chrome");
    expect(repository.getDefaultApplication("浏览器")).toBe("Google Chrome");

    repository.setDefaultApplication("浏览器", "Microsoft Edge");
    expect(repository.getDefaultApplication("浏览器")).toBe("Microsoft Edge");

    db.close();
  });

  it("persists reminders in trigger order", () => {
    const db = createMemoryDatabase();
    const repository = createReminderRepository(db);

    repository.save({
      id: "reminder_later",
      title: "Later",
      triggerAt: "2026-05-19T10:30:00.000Z",
      createdAt: "2026-05-19T10:01:00.000Z",
      status: "active"
    });
    repository.save({
      id: "reminder_soon",
      title: "Soon",
      triggerAt: "2026-05-19T10:05:00.000Z",
      createdAt: "2026-05-19T10:00:00.000Z",
      status: "active"
    });

    expect(repository.list()).toMatchObject([
      {
        id: "reminder_soon",
        title: "Soon",
        triggerAt: "2026-05-19T10:05:00.000Z",
        createdAt: "2026-05-19T10:00:00.000Z",
        status: "active"
      },
      {
        id: "reminder_later",
        title: "Later",
        triggerAt: "2026-05-19T10:30:00.000Z",
        createdAt: "2026-05-19T10:01:00.000Z",
        status: "active"
      }
    ]);

    db.close();
  });

  it("updates, deletes, and cancels the latest active reminder", () => {
    const db = createMemoryDatabase();
    const repository = createReminderRepository(db);

    repository.save({
      id: "reminder_first",
      title: "First",
      triggerAt: "2026-05-19T10:05:00.000Z",
      createdAt: "2026-05-19T10:00:00.000Z",
      status: "active"
    });
    repository.save({
      id: "reminder_second",
      title: "Second",
      triggerAt: "2026-05-19T10:30:00.000Z",
      createdAt: "2026-05-19T10:02:00.000Z",
      status: "active"
    });
    repository.save({
      id: "reminder_done",
      title: "Done",
      triggerAt: "2026-05-19T10:10:00.000Z",
      createdAt: "2026-05-19T10:03:00.000Z",
      status: "completed"
    });

    expect(repository.updateStatus("reminder_first", "completed")).toBe(true);
    expect(repository.updateStatus("missing", "completed")).toBe(false);

    expect(repository.cancelLatestActive()).toMatchObject({
      id: "reminder_second",
      title: "Second",
      status: "cancelled"
    });
    expect(repository.cancelLatestActive()).toBeNull();

    expect(repository.delete("reminder_done")).toBe(true);
    expect(repository.delete("missing")).toBe(false);
    expect(repository.list().map((reminder) => [reminder.id, reminder.status])).toEqual([
      ["reminder_first", "completed"],
      ["reminder_second", "cancelled"]
    ]);

    db.close();
  });

  it("persists accepted memory candidates as recallable memories", () => {
    const db = createMemoryDatabase();
    const repository = createMemoryRepository(db);

    repository.rememberCandidate(
      {
        type: "preference",
        content: "用户喜欢晚上学习时先做轻量复习",
        confidence: 0.92,
        requiresConfirmation: false
      },
      "accepted"
    );
    repository.rememberCandidate(
      {
        type: "sensitive",
        content: "用户的敏感信息需要确认",
        confidence: 0.9,
        requiresConfirmation: true
      },
      "pending_confirmation"
    );

    expect(repository.recall("今晚 学习")).toEqual([
      {
        id: expect.stringMatching(/^memory_/),
        type: "preference",
        content: "用户喜欢晚上学习时先做轻量复习"
      }
    ]);
    expect(repository.listCandidates()).toHaveLength(2);

    db.close();
  });

  it("deduplicates accepted memories by type and normalized content", () => {
    const db = createMemoryDatabase();
    const repository = createMemoryRepository(db);

    repository.rememberCandidate(
      {
        type: "preference",
        content: "用户喜欢被称呼为 Sakura",
        confidence: 0.72,
        requiresConfirmation: false
      },
      "accepted"
    );
    repository.rememberCandidate(
      {
        type: "preference",
        content: "  用户喜欢被称呼为 Sakura  ",
        confidence: 0.94,
        requiresConfirmation: false
      },
      "accepted"
    );

    const recalled = repository.recall("Sakura");

    expect(recalled).toHaveLength(1);
    expect(repository.listMemories()).toMatchObject([
      {
        type: "preference",
        content: "用户喜欢被称呼为 Sakura",
        confidence: 0.94
      }
    ]);

    db.close();
  });

  it("promotes or rejects pending memory candidates", () => {
    const db = createMemoryDatabase();
    const repository = createMemoryRepository(db);

    const pending = repository.rememberCandidate(
      {
        type: "relationship",
        content: "用户希望 Aiko 叫她 Sakura",
        confidence: 0.88,
        requiresConfirmation: true
      },
      "pending_confirmation"
    );
    const rejected = repository.rememberCandidate(
      {
        type: "sensitive",
        content: "用户的敏感信息",
        confidence: 0.9,
        requiresConfirmation: true
      },
      "pending_confirmation"
    );

    expect(repository.listPendingCandidates().map((candidate) => candidate.id)).toEqual([
      pending.candidateId,
      rejected.candidateId
    ]);

    repository.acceptCandidate(pending.candidateId);
    repository.rejectCandidate(rejected.candidateId);

    expect(repository.recall("Sakura")).toMatchObject([
      {
        type: "relationship",
        content: "用户希望 Aiko 叫她 Sakura"
      }
    ]);
    expect(repository.listPendingCandidates()).toEqual([]);
    expect(repository.listCandidates().map((candidate) => candidate.status)).toEqual(["accepted", "rejected"]);

    db.close();
  });
});
