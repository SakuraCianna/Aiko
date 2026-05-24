import type { DatabaseSync } from "node:sqlite";

// 创建当前版本需要的数据库表结构.
export function runMigrations(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      confidence REAL NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_used_at TEXT
    );

    CREATE TABLE IF NOT EXISTS memory_candidates (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      confidence REAL NOT NULL,
      requires_confirmation INTEGER NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS memory_vectors (
      memory_id TEXT PRIMARY KEY,
      vector_json TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(memory_id) REFERENCES memories(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS memory_vec_rowids (
      memory_id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      FOREIGN KEY(memory_id) REFERENCES memories(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS permissions (
      id TEXT PRIMARY KEY,
      capability TEXT NOT NULL,
      target TEXT NOT NULL,
      risk_level TEXT NOT NULL,
      confirmation_policy TEXT NOT NULL,
      created_at TEXT NOT NULL,
      revoked_at TEXT
    );

    CREATE TABLE IF NOT EXISTS reminders (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      detail TEXT,
      trigger_at TEXT NOT NULL,
      repeat_rule TEXT,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS action_journal (
      id TEXT PRIMARY KEY,
      phase TEXT NOT NULL,
      action_id TEXT NOT NULL,
      run_id TEXT,
      capability TEXT NOT NULL,
      target TEXT NOT NULL,
      risk TEXT NOT NULL,
      source TEXT,
      decision TEXT,
      ok INTEGER,
      message TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS agent_traces (
      request_id TEXT PRIMARY KEY,
      started_at TEXT NOT NULL,
      ended_at TEXT
    );

    CREATE TABLE IF NOT EXISTS agent_trace_events (
      id TEXT PRIMARY KEY,
      trace_request_id TEXT NOT NULL,
      name TEXT NOT NULL,
      at TEXT NOT NULL,
      data_json TEXT,
      FOREIGN KEY(trace_request_id) REFERENCES agent_traces(request_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS langgraph_checkpoints (
      thread_id TEXT NOT NULL,
      checkpoint_ns TEXT NOT NULL,
      checkpoint_id TEXT NOT NULL,
      parent_checkpoint_id TEXT,
      checkpoint_type TEXT NOT NULL,
      checkpoint_blob BLOB NOT NULL,
      metadata_type TEXT NOT NULL,
      metadata_blob BLOB NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY(thread_id, checkpoint_ns, checkpoint_id)
    );

    CREATE TABLE IF NOT EXISTS langgraph_checkpoint_writes (
      thread_id TEXT NOT NULL,
      checkpoint_ns TEXT NOT NULL,
      checkpoint_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      idx INTEGER NOT NULL,
      channel TEXT NOT NULL,
      value_type TEXT NOT NULL,
      value_blob BLOB NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY(thread_id, checkpoint_ns, checkpoint_id, task_id, idx),
      FOREIGN KEY(thread_id, checkpoint_ns, checkpoint_id)
        REFERENCES langgraph_checkpoints(thread_id, checkpoint_ns, checkpoint_id)
        ON DELETE CASCADE
    );
  `);
}
