import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { runMigrations } from "../../src/main/database/migrations";
import { createMemoryRepository } from "../../src/main/database/repositories";
import { createSqliteVecMemoryIndex } from "../../src/main/memory/sqliteVecMemoryIndex";

const require = createRequire(import.meta.url);

function createMemoryDatabase(options?: { allowExtension?: boolean }) {
  const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
  const db = new DatabaseSync(":memory:", {
    allowExtension: options?.allowExtension ?? false,
    enableForeignKeyConstraints: true
  });
  runMigrations(db);
  return db;
}

describe("sqlite-vec memory index", () => {
  it("loads sqlite-vec and ranks memories through a vec0 virtual table", () => {
    const db = createMemoryDatabase({ allowExtension: true });
    const index = createSqliteVecMemoryIndex(db);

    expect(index.isAvailable).toBe(true);
    insertAcceptedMemory(db, "memory_coding", "habit", "User likes late night coding with coffee and quiet music.");
    insertAcceptedMemory(db, "memory_browser", "preference", "User prefers Google Chrome as the default browser.");

    index.upsert("memory_coding", "User likes late night coding with coffee and quiet music.");
    index.upsert("memory_browser", "User prefers Google Chrome as the default browser.");

    const virtualRows = db.prepare("SELECT memory_id FROM aiko_memory_vec_index ORDER BY rowid ASC").all();
    expect(virtualRows).toEqual([{ memory_id: "memory_coding" }, { memory_id: "memory_browser" }]);

    expect(
      index.rank(
        [
          {
            id: "memory_browser",
            type: "preference",
            content: "User prefers Google Chrome as the default browser."
          },
          {
            id: "memory_coding",
            type: "habit",
            content: "User likes late night coding with coffee and quiet music."
          }
        ],
        "late night coding coffee",
        1
      )
    ).toEqual([
      {
        id: "memory_coding",
        type: "habit",
        content: "User likes late night coding with coffee and quiet music."
      }
    ]);

    db.close();
  });

  it("falls back cleanly when SQLite extension loading is unavailable", () => {
    const db = createMemoryDatabase();
    const index = createSqliteVecMemoryIndex(db);

    expect(index.isAvailable).toBe(false);
    expect(index.rank([], "anything", 3)).toBeNull();
    expect(() => index.upsert("memory_1", "User likes coffee.")).not.toThrow();

    db.close();
  });

  it("lets the memory repository prefer sqlite-vec while preserving sparse fallback storage", () => {
    const db = createMemoryDatabase({ allowExtension: true });
    const vectorIndex = createSqliteVecMemoryIndex(db);
    const repository = createMemoryRepository(db, { vectorIndex });

    repository.rememberCandidate(
      {
        type: "habit",
        content: "User likes late night coding with coffee and quiet music.",
        confidence: 0.87,
        requiresConfirmation: false
      },
      "accepted"
    );
    repository.rememberCandidate(
      {
        type: "preference",
        content: "User prefers Google Chrome as the default browser.",
        confidence: 0.91,
        requiresConfirmation: false
      },
      "accepted"
    );

    expect(db.prepare("SELECT memory_id FROM memory_vectors ORDER BY memory_id ASC").all()).toHaveLength(2);
    expect(db.prepare("SELECT memory_id FROM aiko_memory_vec_index ORDER BY rowid ASC").all()).toHaveLength(2);
    expect(repository.recall("late night coding coffee", 1)).toMatchObject([
      {
        type: "habit",
        content: "User likes late night coding with coffee and quiet music."
      }
    ]);

    db.close();
  });
});

function insertAcceptedMemory(db: ReturnType<typeof createMemoryDatabase>, id: string, type: string, content: string) {
  db.prepare(
    `
    INSERT INTO memories (id, type, content, confidence, status, created_at, updated_at, last_used_at)
    VALUES (?, ?, ?, 0.9, 'accepted', ?, ?, NULL)
  `
  ).run(id, type, content, "2026-05-24T10:00:00.000Z", "2026-05-24T10:00:00.000Z");
}
