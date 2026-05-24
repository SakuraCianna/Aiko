import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { runMigrations } from "../../src/main/database/migrations";

const require = createRequire(import.meta.url);

describe("runMigrations", () => {
  it("creates the core Aiko tables in a SQLite database", () => {
    const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
    const db = new DatabaseSync(":memory:");

    runMigrations(db);

    const rows = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all() as Array<{ name: string }>;

    expect(rows.map((row) => row.name)).toEqual([
      "action_journal",
      "agent_trace_events",
      "agent_traces",
      "memories",
      "memory_candidates",
      "permissions",
      "reminders",
      "settings"
    ]);
  });
});
