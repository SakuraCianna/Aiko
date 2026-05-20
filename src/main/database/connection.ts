import { app } from "electron";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { runMigrations } from "./migrations";

export type AikoDatabase = {
  db: DatabaseSync;
  close: () => void;
};

export function openDatabase(): AikoDatabase {
  const dbPath = path.join(app.getPath("userData"), "aiko.db");
  const db = new DatabaseSync(dbPath, {
    enableForeignKeyConstraints: true,
    timeout: 5000
  });
  runMigrations(db);

  return {
    db,
    close() {
      db.close();
    }
  };
}
