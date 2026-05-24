export type AikoWorkerDefinition<Input = unknown, Output = unknown> = {
  name: string;
  description: string;
  run: (input: Input) => Promise<Output> | Output;
};

export type AikoWorkerSummary = {
  name: string;
  description: string;
};

export type AikoWorkerRegistry = ReturnType<typeof createAikoWorkerRegistry>;

// 创建内部 worker 注册表, 让 Aiko 保持单角色表现但内部可拆分子任务.
export function createAikoWorkerRegistry() {
  const workers = new Map<string, AikoWorkerDefinition>();

  return {
    // 注册一个内部 worker, 同名 worker 会被新定义替换.
    register(worker: AikoWorkerDefinition) {
      workers.set(worker.name, worker);
    },

    // 列出可用 worker 的公开摘要.
    list(): AikoWorkerSummary[] {
      return [...workers.values()].map(({ name, description }) => ({ name, description }));
    },

    // 运行指定 worker, 未注册时抛出明确错误.
    async run(name: string, input: unknown) {
      const worker = workers.get(name);
      if (!worker) throw new Error(`Unknown Aiko worker: ${name}`);
      return worker.run(input);
    }
  };
}
