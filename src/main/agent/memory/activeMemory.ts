import type { RecalledMemory } from "../../memory/memoryRecall";
import type { AikoMemoryAgent } from "../subagents/memoryAgent";

export type AikoActiveMemorySelectorOptions = {
  memoryAgent: AikoMemoryAgent;
  timeoutMs?: number;
  maxMemories?: number;
};

export type AikoActiveMemorySelector = ReturnType<typeof createAikoActiveMemorySelector>;

// 创建回复前主动记忆选择器, 用短超时保护主对话链路.
export function createAikoActiveMemorySelector(options: AikoActiveMemorySelectorOptions) {
  const timeoutMs = options.timeoutMs ?? 250;
  const maxMemories = options.maxMemories ?? 5;

  return {
    // 选择与当前输入最相关的少量长期记忆, 失败或超时时直接降级为空.
    async select(query: string): Promise<RecalledMemory[]> {
      const trimmed = query.trim();
      if (!trimmed) return [];

      try {
        const memories = await withTimeout(options.memoryAgent.recall(trimmed, maxMemories), timeoutMs);
        return memories.slice(0, maxMemories);
      } catch {
        return [];
      }
    }
  };
}

// 给记忆选择添加硬超时, 防止 SQLite 或外部子流程阻塞主模型.
function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("active memory timeout")), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}
