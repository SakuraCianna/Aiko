import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { runMigrations } from "../../src/main/database/migrations";
import {
  createApplicationPreferenceRepository,
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
      status: "active"
    });
    repository.save({
      id: "reminder_soon",
      title: "Soon",
      triggerAt: "2026-05-19T10:05:00.000Z",
      status: "active"
    });

    expect(repository.list()).toMatchObject([
      {
        id: "reminder_soon",
        title: "Soon",
        triggerAt: "2026-05-19T10:05:00.000Z",
        status: "active"
      },
      {
        id: "reminder_later",
        title: "Later",
        triggerAt: "2026-05-19T10:30:00.000Z",
        status: "active"
      }
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
