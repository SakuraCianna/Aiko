import { app } from "electron";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { runMigrations } from "./migrations";

export type AikoDatabase = {
  db: DatabaseSync;
  close: () => void;
};

// 打开 Aiko 本地数据库, 并在启动时执行迁移.
export function openDatabase(): AikoDatabase {
  const dbPath = path.join(app.getPath("userData"), "aiko.db");
  const db = new DatabaseSync(dbPath, {
    allowExtension: true,
    enableForeignKeyConstraints: true,
    timeout: 5000
  });
  runMigrations(db);

  return {
    db,
    // 关闭底层 SQLite 连接.
    close() {
      db.close();
    }
  };
}
