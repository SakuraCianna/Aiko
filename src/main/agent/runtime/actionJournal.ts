import { randomUUID } from "node:crypto";
import type { ExecuteActionResponse, PendingActionDto } from "../../../shared/ipcTypes";

export type AikoActionJournalPhase = "planned" | "approval" | "execution";
export type AikoActionApprovalDecision = "approved" | "rejected" | "cancelled";

export type AikoActionJournalEntry = {
  id: string;
  phase: AikoActionJournalPhase;
  actionId: string;
  runId?: string;
  capability: string;
  target: string;
  risk: PendingActionDto["risk"];
  source?: string;
  decision?: AikoActionApprovalDecision;
  ok?: boolean;
  message?: string;
  createdAt: string;
};

export type AikoActionJournalOptions = {
  idFactory?: () => string;
  actionIdFactory?: () => string;
  now?: () => Date;
  maxRecords?: number;
};

export type AikoActionJournal = ReturnType<typeof createAikoActionJournal>;

// 创建动作日志, 用于追踪规划, 审批和执行结果.
export function createAikoActionJournal(options: AikoActionJournalOptions = {}) {
  const idFactory = options.idFactory ?? (() => `journal_${randomUUID()}`);
  const actionIdFactory = options.actionIdFactory ?? (() => `action_${randomUUID()}`);
  const now = options.now ?? (() => new Date());
  const maxRecords = options.maxRecords ?? 200;
  const entries: AikoActionJournalEntry[] = [];

  return {
    // 确保动作有稳定 ID, 方便审批和执行阶段关联同一条记录.
    ensureActionId(action: PendingActionDto): PendingActionDto {
      if (action.id) return action;
      return {
        ...action,
        id: actionIdFactory(),
        actions: action.actions?.map((child) => this.ensureActionId(child))
      };
    },

    // 记录已经规划出的待执行动作.
    recordPlanned(input: { runId?: string; action: PendingActionDto; source: string }) {
      record(entries, maxRecords, {
        id: idFactory(),
        phase: "planned",
        actionId: readActionId(input.action),
        runId: input.runId,
        capability: input.action.capability,
        target: input.action.target,
        risk: input.action.risk,
        source: input.source,
        createdAt: now().toISOString()
      });
    },

    // 记录用户或系统对待执行动作的审批决定.
    recordApproval(input: { action: PendingActionDto; decision: AikoActionApprovalDecision; reason?: string }) {
      record(entries, maxRecords, {
        id: idFactory(),
        phase: "approval",
        actionId: readActionId(input.action),
        capability: input.action.capability,
        target: input.action.target,
        risk: input.action.risk,
        decision: input.decision,
        message: input.reason,
        createdAt: now().toISOString()
      });
    },

    // 记录本地动作执行结果, 后续可以用于撤销, 重试和诊断.
    recordExecutionResult(input: { action: PendingActionDto } & ExecuteActionResponse) {
      record(entries, maxRecords, {
        id: idFactory(),
        phase: "execution",
        actionId: readActionId(input.action),
        capability: input.action.capability,
        target: input.action.target,
        risk: input.action.risk,
        ok: input.ok,
        message: input.message,
        createdAt: now().toISOString()
      });
    },

    // 返回日志快照, 避免调用方直接修改内部数组.
    list() {
      return entries.map((entry) => ({ ...entry }));
    }
  };
}

// 追加一条日志并限制最大数量.
function record(entries: AikoActionJournalEntry[], maxRecords: number, entry: AikoActionJournalEntry) {
  entries.push(entry);
  while (entries.length > maxRecords) {
    entries.shift();
  }
}

// 读取动作 ID, 测试或旧调用未传 ID 时退回到 capability/target 组合.
function readActionId(action: PendingActionDto) {
  return action.id ?? `${action.capability}:${action.target}`;
}
