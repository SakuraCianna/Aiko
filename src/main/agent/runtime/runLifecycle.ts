import { randomUUID } from "node:crypto";

export type AikoRunStatus = "accepted" | "running" | "waiting_approval" | "completed" | "failed" | "cancelled";

export type AikoRunRecord = {
  id: string;
  sessionId: string;
  status: AikoRunStatus;
  userText: string;
  createdAt: string;
  updatedAt: string;
  summary?: string;
  error?: string;
};

export type AikoRunLifecycleOptions = {
  idFactory?: () => string;
  now?: () => Date;
  maxRecords?: number;
};

export type AikoRunLifecycle = ReturnType<typeof createAikoRunLifecycle>;

// 创建请求生命周期管理器, 记录每一轮请求状态并串行化主运行队列.
export function createAikoRunLifecycle(options: AikoRunLifecycleOptions = {}) {
  const idFactory = options.idFactory ?? (() => `run_${randomUUID()}`);
  const now = options.now ?? (() => new Date());
  const maxRecords = options.maxRecords ?? 100;
  const runs: AikoRunRecord[] = [];
  let queue: Promise<unknown> = Promise.resolve();

  return {
    // 创建一条已接收的运行记录.
    createRun(input: { sessionId?: string; userText: string }) {
      const timestamp = now().toISOString();
      const run: AikoRunRecord = {
        id: idFactory(),
        sessionId: input.sessionId ?? "default",
        status: "accepted",
        userText: input.userText,
        createdAt: timestamp,
        updatedAt: timestamp
      };
      runs.push(run);
      trimRuns(runs, maxRecords);
      return cloneRun(run);
    },

    // 标记请求进入执行阶段.
    markRunning(runId: string) {
      updateRun(runs, runId, now, { status: "running" });
    },

    // 标记请求正在等待用户审批.
    markWaitingApproval(runId: string, summary?: string) {
      updateRun(runs, runId, now, { status: "waiting_approval", summary });
    },

    // 标记请求已经完成.
    markCompleted(runId: string, summary?: string) {
      updateRun(runs, runId, now, { status: "completed", summary });
    },

    // 标记请求失败并记录简短错误.
    markFailed(runId: string, error: unknown) {
      updateRun(runs, runId, now, { status: "failed", error: formatLifecycleError(error) });
    },

    // 标记请求被用户或系统取消.
    markCancelled(runId: string, summary?: string) {
      updateRun(runs, runId, now, { status: "cancelled", summary });
    },

    // 返回不可变快照, 避免外部修改内部状态.
    listRuns() {
      return runs.map(cloneRun);
    },

    // 串行化主请求执行, 防止模型流和工具审批交叉污染.
    enqueue<T>(work: () => Promise<T>): Promise<T> {
      const next = queue.then(work, work);
      queue = next.catch(() => undefined);
      return next;
    }
  };
}

// 更新指定运行记录, 并统一刷新更新时间.
function updateRun(
  runs: AikoRunRecord[],
  runId: string,
  now: () => Date,
  patch: Partial<Pick<AikoRunRecord, "status" | "summary" | "error">>
) {
  const run = runs.find((candidate) => candidate.id === runId);
  if (!run) return;
  Object.assign(run, patch, { updatedAt: now().toISOString() });
}

// 限制生命周期记录数量, 避免长时间运行后内存无限增长.
function trimRuns(runs: AikoRunRecord[], maxRecords: number) {
  while (runs.length > maxRecords) {
    runs.shift();
  }
}

// 克隆运行记录, 让调用方只能读取快照.
function cloneRun(run: AikoRunRecord): AikoRunRecord {
  return { ...run };
}

// 把未知异常压缩成安全的生命周期错误文本.
function formatLifecycleError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
