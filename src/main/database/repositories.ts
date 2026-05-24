import type { DatabaseSync } from "node:sqlite";
import type { AikoActionJournalEntry } from "../agent/runtime/actionJournal";
import type { AikoTraceEvent, AikoTraceRecord } from "../agent/trace/aikoTrace";
import {
  createMemoryVector,
  rankMemoriesByVector,
  type MemoryVector,
  type RecalledMemory
} from "../memory/memoryRecall";
import type { AikoMemoryVectorIndex } from "../memory/sqliteVecMemoryIndex";
import type { MemoryCandidate, MemoryStatus } from "../memory/memoryTypes";
import type { PermissionRule } from "../permissions/permissionService";
import type { Reminder, ReminderStatus } from "../reminders/reminderService";

// 返回当前时间的 ISO 字符串.
export function nowIso() {
  return new Date().toISOString();
}

// 根据前缀创建带命名空间的随机 ID.
export function createId(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`;
}

export type PermissionRepository = ReturnType<typeof createPermissionRepository>;
export type ReminderRepository = ReturnType<typeof createReminderRepository>;
export type MemoryRepository = ReturnType<typeof createMemoryRepository>;
export type ApplicationPreferenceRepository = ReturnType<typeof createApplicationPreferenceRepository>;
export type AuditRepository = ReturnType<typeof createAuditRepository>;

type MemoryRepositoryOptions = {
  vectorIndex?: AikoMemoryVectorIndex;
};

type MemoryRow = {
  id: string;
  type: MemoryCandidate["type"];
  content: string;
  confidence: number;
  status: MemoryStatus;
  created_at: string;
  updated_at: string;
  last_used_at: string | null;
};

type MemoryCandidateRow = {
  id: string;
  type: MemoryCandidate["type"];
  content: string;
  confidence: number;
  requires_confirmation: 0 | 1;
  status: MemoryStatus;
  created_at: string;
};

type MemoryVectorRow = {
  memory_id: string;
  vector_json: string;
};

// 定义审计仓储读取 SQLite 行时使用的结构.
type ActionJournalRow = {
  id: string;
  phase: AikoActionJournalEntry["phase"];
  action_id: string;
  run_id: string | null;
  capability: string;
  target: string;
  risk: AikoActionJournalEntry["risk"];
  source: string | null;
  decision: AikoActionJournalEntry["decision"] | null;
  ok: 0 | 1 | null;
  message: string | null;
  created_at: string;
};

type TraceRow = {
  request_id: string;
  started_at: string;
  ended_at: string | null;
};

type TraceEventRow = {
  trace_request_id: string;
  name: string;
  at: string;
  data_json: string | null;
};

// 创建审计仓库, 负责持久化动作日志和 Agent trace.
export function createAuditRepository(db: DatabaseSync) {
  return {
    // 保存一条动作审计日志.
    recordActionJournalEntry(entry: AikoActionJournalEntry) {
      db.prepare(
        `
        INSERT INTO action_journal (
          id,
          phase,
          action_id,
          run_id,
          capability,
          target,
          risk,
          source,
          decision,
          ok,
          message,
          created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
      ).run(
        entry.id,
        entry.phase,
        entry.actionId,
        entry.runId ?? null,
        entry.capability,
        entry.target,
        entry.risk,
        entry.source ?? null,
        entry.decision ?? null,
        typeof entry.ok === "boolean" ? (entry.ok ? 1 : 0) : null,
        entry.message ?? null,
        entry.createdAt
      );
    },

    // 按时间顺序读取动作审计日志.
    listActionJournal(): AikoActionJournalEntry[] {
      const rows = db
        .prepare(
          `
          SELECT id, phase, action_id, run_id, capability, target, risk, source, decision, ok, message, created_at
          FROM action_journal
          ORDER BY created_at ASC, rowid ASC
        `
        )
        .all() as ActionJournalRow[];

      return rows.map(mapActionJournalRow);
    },

    // 创建一条 trace 记录.
    startTrace(trace: Pick<AikoTraceRecord, "requestId" | "startedAt">) {
      db.prepare(
        `
        INSERT INTO agent_traces (request_id, started_at, ended_at)
        VALUES (?, ?, NULL)
        ON CONFLICT(request_id) DO UPDATE SET
          started_at = excluded.started_at,
          ended_at = NULL
      `
      ).run(trace.requestId, trace.startedAt);
    },

    // 为 trace 添加一条事件.
    addTraceEvent(requestId: string, event: AikoTraceEvent) {
      db.prepare(
        `
        INSERT INTO agent_trace_events (id, trace_request_id, name, at, data_json)
        VALUES (?, ?, ?, ?, ?)
      `
      ).run(createId("trace_event"), requestId, event.name, event.at, event.data ? JSON.stringify(event.data) : null);
    },

    // 标记 trace 结束.
    endTrace(requestId: string, endedAt: string) {
      db.prepare("UPDATE agent_traces SET ended_at = ? WHERE request_id = ?").run(endedAt, requestId);
    },

    // 读取完整 trace 及事件列表.
    listTraces(): AikoTraceRecord[] {
      const traces = db
        .prepare(
          `
          SELECT request_id, started_at, ended_at
          FROM agent_traces
          ORDER BY started_at ASC, rowid ASC
        `
        )
        .all() as TraceRow[];
      const events = db
        .prepare(
          `
          SELECT trace_request_id, name, at, data_json
          FROM agent_trace_events
          ORDER BY at ASC, rowid ASC
        `
        )
        .all() as TraceEventRow[];
      const eventsByTrace = groupTraceEvents(events);

      return traces.map((trace) => ({
        requestId: trace.request_id,
        startedAt: trace.started_at,
        endedAt: trace.ended_at,
        events: eventsByTrace.get(trace.request_id) ?? []
      }));
    }
  };
}

// 将动作日志数据库行转为运行时结构.
function mapActionJournalRow(row: ActionJournalRow): AikoActionJournalEntry {
  return {
    id: row.id,
    phase: row.phase,
    actionId: row.action_id,
    runId: row.run_id ?? undefined,
    capability: row.capability,
    target: row.target,
    risk: row.risk,
    source: row.source ?? undefined,
    decision: row.decision ?? undefined,
    ok: row.ok === null ? undefined : Boolean(row.ok),
    message: row.message ?? undefined,
    createdAt: row.created_at
  };
}

// 按 request id 聚合 trace 事件.
function groupTraceEvents(rows: TraceEventRow[]): Map<string, AikoTraceEvent[]> {
  const grouped = new Map<string, AikoTraceEvent[]>();
  for (const row of rows) {
    const events = grouped.get(row.trace_request_id) ?? [];
    events.push({
      name: row.name,
      at: row.at,
      data: parseTraceData(row.data_json)
    });
    grouped.set(row.trace_request_id, events);
  }
  return grouped;
}

// 安全解析 trace 事件数据, 坏数据降级为空对象.
function parseTraceData(value: string | null): Record<string, unknown> | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}

// 创建长期记忆仓储, 负责候选记忆和已接受记忆的读写.
export function createMemoryRepository(db: DatabaseSync, options: MemoryRepositoryOptions = {}) {
  return {
    // 保存一个记忆候选, 如果已接受则同步写入长期记忆.
    rememberCandidate(candidate: MemoryCandidate, status: MemoryStatus) {
      const candidateId = createId("memory_candidate");
      db.prepare(
        `
        INSERT INTO memory_candidates (
          id,
          type,
          content,
          confidence,
          requires_confirmation,
          status,
          created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `
      ).run(
        candidateId,
        candidate.type,
        candidate.content,
        candidate.confidence,
        candidate.requiresConfirmation ? 1 : 0,
        status,
        nowIso()
      );

      let memoryId: string | null = null;
      if (status === "accepted") {
        memoryId = upsertAcceptedMemory(db, candidate, options.vectorIndex);
      }

      return { candidateId, memoryId };
    },

    // 根据查询文本召回相关长期记忆.
    recall(query: string, limit = 5): RecalledMemory[] {
      const vectorByMemoryId = listMemoryVectorRows(db);
      const rows = listAcceptedMemoryRows(db).map((row) => ({
        id: row.id,
        type: row.type,
        content: row.content,
        vector: vectorByMemoryId.get(row.id) ?? upsertMemoryVector(db, row.id, row.content)
      }));
      for (const row of rows) {
        options.vectorIndex?.upsert(row.id, row.content);
      }

      const vectorIndexResult = options.vectorIndex?.rank(rows, query, limit);
      if (vectorIndexResult && vectorIndexResult.length > 0) return vectorIndexResult;

      return rankMemoriesByVector(rows, query, limit);
    },

    // 列出全部记忆候选.
    listCandidates() {
      return listCandidateRows(db).map(mapMemoryCandidateRow);
    },

    // 列出等待用户确认的记忆候选.
    listPendingCandidates() {
      return listCandidateRows(db)
        .filter((row) => row.status === "pending_confirmation")
        .map(mapMemoryCandidateRow);
    },

    // 列出已接受的长期记忆.
    listMemories() {
      return listAcceptedMemoryRows(db).map((row) => ({
        id: row.id,
        type: row.type,
        content: row.content,
        confidence: row.confidence,
        status: row.status,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        lastUsedAt: row.last_used_at
      }));
    },

    // 接受一个待确认记忆候选并提升为长期记忆.
    acceptCandidate(candidateId: string) {
      const row = getCandidateRow(db, candidateId);
      if (!row) return false;

      db.prepare("UPDATE memory_candidates SET status = ? WHERE id = ?").run("accepted", candidateId);
      upsertAcceptedMemory(
        db,
        {
          type: row.type,
          content: row.content,
          confidence: row.confidence,
          requiresConfirmation: Boolean(row.requires_confirmation)
        },
        options.vectorIndex
      );
      return true;
    },

    // 拒绝一个待确认记忆候选.
    rejectCandidate(candidateId: string) {
      const result = db.prepare("UPDATE memory_candidates SET status = ? WHERE id = ?").run("rejected", candidateId);
      return result.changes > 0;
    }
  };
}

// 写入已接受记忆, 已存在同类内容时更新置信度.
function upsertAcceptedMemory(
  db: DatabaseSync,
  candidate: MemoryCandidate,
  vectorIndex?: AikoMemoryVectorIndex
): string {
  const normalizedContent = normalizeMemoryContent(candidate.content);
  const duplicate = listAcceptedMemoryRows(db).find(
    (row) => row.type === candidate.type && normalizeMemoryContent(row.content) === normalizedContent
  );

  if (duplicate) {
    db.prepare(
      `
      UPDATE memories
      SET confidence = ?,
          updated_at = ?
      WHERE id = ?
    `
    ).run(Math.max(duplicate.confidence, candidate.confidence), nowIso(), duplicate.id);
    upsertMemoryVector(db, duplicate.id, duplicate.content);
    vectorIndex?.upsert(duplicate.id, duplicate.content);
    return duplicate.id;
  }

  const memoryId = createId("memory");
  const timestamp = nowIso();
  db.prepare(
    `
    INSERT INTO memories (
      id,
      type,
      content,
      confidence,
      status,
      created_at,
      updated_at,
      last_used_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
  `
  ).run(memoryId, candidate.type, candidate.content.trim(), candidate.confidence, "accepted", timestamp, timestamp);
  upsertMemoryVector(db, memoryId, candidate.content);
  vectorIndex?.upsert(memoryId, candidate.content);
  return memoryId;
}

// 写入或刷新记忆的本地向量索引.
function upsertMemoryVector(db: DatabaseSync, memoryId: string, content: string): MemoryVector {
  const vector = createMemoryVector(content);
  db.prepare(
    `
    INSERT INTO memory_vectors (memory_id, vector_json, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(memory_id) DO UPDATE SET
      vector_json = excluded.vector_json,
      updated_at = excluded.updated_at
  `
  ).run(memoryId, JSON.stringify(vector), nowIso());
  return vector;
}

// 读取已持久化的记忆向量, 坏数据会被忽略并在召回时重建.
function listMemoryVectorRows(db: DatabaseSync): Map<string, MemoryVector> {
  const rows = db
    .prepare(
      `
      SELECT memory_id, vector_json
      FROM memory_vectors
    `
    )
    .all() as MemoryVectorRow[];

  const vectors = new Map<string, MemoryVector>();
  for (const row of rows) {
    const vector = parseMemoryVector(row.vector_json);
    if (vector) vectors.set(row.memory_id, vector);
  }
  return vectors;
}

// 安全解析本地向量 JSON.
function parseMemoryVector(value: string): MemoryVector | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const vector: MemoryVector = {};
    for (const [term, weight] of Object.entries(parsed)) {
      if (typeof weight === "number" && Number.isFinite(weight)) vector[term] = weight;
    }
    return Object.keys(vector).length > 0 ? vector : null;
  } catch {
    return null;
  }
}

// 读取所有已接受记忆行.
function listAcceptedMemoryRows(db: DatabaseSync): MemoryRow[] {
  return db
    .prepare(
      `
      SELECT id, type, content, confidence, status, created_at, updated_at, last_used_at
      FROM memories
      WHERE status = 'accepted'
      ORDER BY updated_at DESC, created_at DESC, rowid DESC
    `
    )
    .all() as MemoryRow[];
}

// 读取所有记忆候选行.
function listCandidateRows(db: DatabaseSync): MemoryCandidateRow[] {
  return db
    .prepare(
      `
      SELECT id, type, content, confidence, requires_confirmation, status, created_at
      FROM memory_candidates
      ORDER BY rowid ASC
    `
    )
    .all() as MemoryCandidateRow[];
}

// 根据 ID 查询单个记忆候选.
function getCandidateRow(db: DatabaseSync, candidateId: string): MemoryCandidateRow | null {
  const row = db
    .prepare(
      `
      SELECT id, type, content, confidence, requires_confirmation, status, created_at
      FROM memory_candidates
      WHERE id = ?
      LIMIT 1
    `
    )
    .get(candidateId) as MemoryCandidateRow | undefined;

  return row ?? null;
}

// 把数据库行转换成前端可用的记忆候选对象.
function mapMemoryCandidateRow(row: MemoryCandidateRow) {
  return {
    id: row.id,
    type: row.type,
    content: row.content,
    confidence: row.confidence,
    requiresConfirmation: Boolean(row.requires_confirmation),
    status: row.status,
    createdAt: row.created_at
  };
}

// 归一化记忆内容, 用于去重.
function normalizeMemoryContent(content: string) {
  return content.trim().replace(/\s+/g, " ").toLowerCase();
}

// 创建权限仓储, 负责记住和查询用户授权规则.
export function createPermissionRepository(db: DatabaseSync) {
  return {
    // 只记住低风险权限规则, 中高风险动作每次都需要确认.
    remember(rule: PermissionRule) {
      if (rule.risk !== "low") return;

      const normalizedTarget = normalizeTarget(rule.target);
      db.prepare(
        `
        INSERT INTO permissions (
          id,
          capability,
          target,
          risk_level,
          confirmation_policy,
          created_at,
          revoked_at
        )
        VALUES (?, ?, ?, ?, ?, ?, NULL)
        ON CONFLICT(id) DO UPDATE SET
          risk_level = excluded.risk_level,
          confirmation_policy = excluded.confirmation_policy,
          revoked_at = NULL
      `
      ).run(permissionId(rule.capability, normalizedTarget), rule.capability, normalizedTarget, rule.risk, "remembered", nowIso());
    },

    // 判断某个权限规则是否仍然有效.
    has(rule: Pick<PermissionRule, "capability" | "target">) {
      const row = db
        .prepare(
          `
          SELECT id
          FROM permissions
          WHERE id = ? AND risk_level = 'low' AND revoked_at IS NULL
          LIMIT 1
        `
        )
        .get(permissionId(rule.capability, normalizeTarget(rule.target)));

      return Boolean(row);
    },

    // 列出所有未撤销的权限规则.
    list(): PermissionRule[] {
      const rows = db
        .prepare(
          `
          SELECT capability, target, risk_level
          FROM permissions
          WHERE risk_level = 'low' AND revoked_at IS NULL
          ORDER BY created_at ASC, capability ASC, target ASC
        `
        )
        .all() as Array<{ capability: string; target: string; risk_level: PermissionRule["risk"] }>;

      return rows.map((row) => ({
        capability: row.capability,
        target: row.target,
        risk: row.risk_level
      }));
    }
  };
}

// 创建应用偏好仓储, 负责保存"默认浏览器"这类用户选择.
export function createApplicationPreferenceRepository(db: DatabaseSync) {
  return {
    // 保存某类泛称应用的默认打开目标.
    setDefaultApplication(defaultFor: string, target: string) {
      db.prepare(
        `
        INSERT INTO settings (key, value)
        VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `
      ).run(defaultApplicationKey(defaultFor), target.trim());
    },

    // 读取某类泛称应用的默认打开目标.
    getDefaultApplication(defaultFor: string) {
      const row = db
        .prepare("SELECT value FROM settings WHERE key = ? LIMIT 1")
        .get(defaultApplicationKey(defaultFor)) as { value: string } | undefined;
      return row?.value ?? null;
    }
  };
}

type ReminderRow = {
  id: string;
  title: string;
  trigger_at: string;
  status: ReminderStatus;
  created_at: string;
};

// 创建提醒仓储, 负责保存, 更新和列出提醒.
export function createReminderRepository(db: DatabaseSync) {
  return {
    // 保存或更新一个提醒.
    save(reminder: Reminder) {
      db.prepare(
        `
        INSERT INTO reminders (
          id,
          title,
          detail,
          trigger_at,
          repeat_rule,
          status,
          created_at
        )
        VALUES (?, ?, NULL, ?, NULL, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          title = excluded.title,
          trigger_at = excluded.trigger_at,
          status = excluded.status
      `
      ).run(reminder.id, reminder.title, reminder.triggerAt, reminder.status, reminder.createdAt);
    },

    // 按触发时间列出提醒.
    list(): Reminder[] {
      const rows = db
        .prepare(
          `
          SELECT id, title, trigger_at, status, created_at
          FROM reminders
          ORDER BY trigger_at ASC, created_at ASC
        `
        )
        .all() as ReminderRow[];

      return rows.map(mapReminderRow);
    },

    // 更新提醒状态, 供面板完成, 暂停或取消提醒.
    updateStatus(reminderId: string, status: ReminderStatus) {
      const result = db.prepare("UPDATE reminders SET status = ? WHERE id = ?").run(status, reminderId);
      return result.changes > 0;
    },

    // 删除一条提醒.
    delete(reminderId: string) {
      const result = db.prepare("DELETE FROM reminders WHERE id = ?").run(reminderId);
      return result.changes > 0;
    },

    // 取消最近创建的激活提醒, 用于自然语言"取消刚才那个提醒".
    cancelLatestActive(): Reminder | null {
      const row = db
        .prepare(
          `
          SELECT id, title, trigger_at, status, created_at
          FROM reminders
          WHERE status = 'active'
          ORDER BY created_at DESC, rowid DESC
          LIMIT 1
        `
        )
        .get() as ReminderRow | undefined;
      if (!row) return null;

      db.prepare("UPDATE reminders SET status = ? WHERE id = ?").run("cancelled", row.id);
      return mapReminderRow({
        ...row,
        status: "cancelled"
      });
    }
  };
}

// 把提醒数据库行转换为业务对象.
function mapReminderRow(row: ReminderRow): Reminder {
  return {
    id: row.id,
    title: row.title,
    triggerAt: row.trigger_at,
    createdAt: row.created_at,
    status: row.status
  };
}

// 归一化权限目标, 用于稳定匹配.
function normalizeTarget(target: string) {
  return target.trim().toLowerCase();
}

// 根据能力和目标生成权限主键.
function permissionId(capability: string, target: string) {
  return `permission:${capability}:${target}`;
}

// 生成默认应用偏好的设置 key.
function defaultApplicationKey(defaultFor: string) {
  return `default_application:${normalizeTarget(defaultFor)}`;
}
