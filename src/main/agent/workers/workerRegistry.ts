export type AikoWorkerDefinition<Input = unknown, Output = unknown> = {
  name: string;
  description: string;
  run: (input: Input) => Promise<Output> | Output;
};

export type AikoWorkerSummary = {
  name: string;
  description: string;
};

export type AikoWorkerRunRecord = {
  id: string;
  workerName: string;
  status: "running" | "completed" | "failed";
  attempts: number;
  inputSummary: string;
  outputSummary?: string;
  error?: string;
  startedAt: string;
  endedAt?: string;
};

export type AikoWorkerRunOptions = {
  maxAttempts?: number;
};

export type AikoWorkerRegistry = ReturnType<typeof createAikoWorkerRegistry>;

const MAX_WORKER_RUNS = 40;

// 创建内部 worker 注册表, 让 Aiko 保持单角色表现, 内部可以拆分子任务.
export function createAikoWorkerRegistry() {
  const workers = new Map<string, AikoWorkerDefinition>();
  const runs: AikoWorkerRunRecord[] = [];

  return {
    // 注册一个内部 worker, 同名 worker 会被新定义替换.
    register(worker: AikoWorkerDefinition) {
      workers.set(worker.name, worker);
    },

    // 列出可用 worker 的公开摘要.
    list(): AikoWorkerSummary[] {
      return [...workers.values()].map(({ name, description }) => ({ name, description }));
    },

    // 运行指定 worker, 并记录调度结果用于调试和产品化任务展示.
    async run(name: string, input: unknown, options: AikoWorkerRunOptions = {}) {
      const worker = workers.get(name);
      if (!worker) throw new Error(`Unknown Aiko worker: ${name}`);
      const run = createWorkerRunRecord(name, input);
      runs.push(run);
      trimWorkerRuns(runs);
      const maxAttempts = normalizeMaxAttempts(options.maxAttempts);

      let lastError: unknown = null;
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        run.attempts = attempt;
        try {
          const output = await worker.run(input);
          run.status = "completed";
          run.outputSummary = summarizeWorkerPayload(output);
          run.error = undefined;
          run.endedAt = new Date().toISOString();
          return output;
        } catch (error) {
          lastError = error;
          run.error = error instanceof Error ? error.message : String(error);
        }
      }

      run.status = "failed";
      run.endedAt = new Date().toISOString();
      throw lastError;
    },

    // 列出最近的 worker 调度记录.
    listRuns(): AikoWorkerRunRecord[] {
      return runs.map((run) => ({ ...run }));
    }
  };
}

// 创建一次 worker 调度记录, 输入摘要会被截断避免调试面板显示过大的上下文.
function createWorkerRunRecord(workerName: string, input: unknown): AikoWorkerRunRecord {
  return {
    id: `worker_run_${crypto.randomUUID()}`,
    workerName,
    status: "running",
    attempts: 0,
    inputSummary: summarizeWorkerPayload(input),
    startedAt: new Date().toISOString()
  };
}

// 规整 worker 重试次数, 防止内部调用者把重试放大成后台风暴.
function normalizeMaxAttempts(value: number | undefined) {
  if (!Number.isInteger(value) || !value || value < 1) return 1;
  return Math.min(value, 3);
}

// 把 worker 输入输出压缩成短摘要.
function summarizeWorkerPayload(value: unknown) {
  try {
    const text = typeof value === "string" ? value : JSON.stringify(value);
    if (!text) return "";
    return text.length <= 220 ? text : `${text.slice(0, 220)}...`;
  } catch {
    return String(value);
  }
}

// 限制内存中的 worker 调度记录数量.
function trimWorkerRuns(runs: AikoWorkerRunRecord[]) {
  while (runs.length > MAX_WORKER_RUNS) {
    runs.shift();
  }
}
