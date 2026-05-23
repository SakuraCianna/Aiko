import type { DatabaseSync } from "node:sqlite";
import { recallMemories, type RecalledMemory } from "../memory/memoryRecall";
import type { MemoryCandidate, MemoryStatus } from "../memory/memoryTypes";
import type { PermissionRule } from "../permissions/permissionService";
import type { Reminder } from "../reminders/reminderService";

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

// 创建长期记忆仓储, 负责候选记忆和已接受记忆的读写.
export function createMemoryRepository(db: DatabaseSync) {
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
        memoryId = upsertAcceptedMemory(db, candidate);
      }

      return { candidateId, memoryId };
    },

    // 根据查询文本召回相关长期记忆.
    recall(query: string, limit = 5): RecalledMemory[] {
      const rows = listAcceptedMemoryRows(db).map((row) => ({
        id: row.id,
        type: row.type,
        content: row.content
      }));

      return recallMemories(rows, query, limit);
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
      upsertAcceptedMemory(db, {
        type: row.type,
        content: row.content,
        confidence: row.confidence,
        requiresConfirmation: Boolean(row.requires_confirmation)
      });
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
function upsertAcceptedMemory(db: DatabaseSync, candidate: MemoryCandidate): string {
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
  return memoryId;
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
    // 记住一个非高风险权限规则.
    remember(rule: PermissionRule) {
      if (rule.risk === "high") return;

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
          WHERE id = ? AND revoked_at IS NULL
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
          WHERE revoked_at IS NULL
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

// 创建提醒仓储, 负责保存和列出提醒.
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
      ).run(reminder.id, reminder.title, reminder.triggerAt, reminder.status, nowIso());
    },

    // 按触发时间列出提醒.
    list(): Reminder[] {
      const rows = db
        .prepare(
          `
          SELECT id, title, trigger_at, status
          FROM reminders
          ORDER BY trigger_at ASC, created_at ASC
        `
        )
        .all() as Array<{ id: string; title: string; trigger_at: string; status: Reminder["status"] }>;

      return rows.map((row) => ({
        id: row.id,
        title: row.title,
        triggerAt: row.trigger_at,
        status: row.status
      }));
    }
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
