import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { runMigrations } from "../../src/main/database/migrations";
import { createPermissionRepository, createReminderRepository } from "../../src/main/database/repositories";

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
});
