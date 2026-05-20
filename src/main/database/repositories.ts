import type { DatabaseSync } from "node:sqlite";
import type { PermissionRule } from "../permissions/permissionService";
import type { Reminder } from "../reminders/reminderService";

export function nowIso() {
  return new Date().toISOString();
}

export function createId(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`;
}

export type PermissionRepository = ReturnType<typeof createPermissionRepository>;
export type ReminderRepository = ReturnType<typeof createReminderRepository>;

export function createPermissionRepository(db: DatabaseSync) {
  return {
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

export function createReminderRepository(db: DatabaseSync) {
  return {
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

function normalizeTarget(target: string) {
  return target.trim().toLowerCase();
}

function permissionId(capability: string, target: string) {
  return `permission:${capability}:${target}`;
}
