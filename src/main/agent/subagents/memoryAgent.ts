import type { RecalledMemory } from "../../memory/memoryRecall";
import type { MemoryCandidate } from "../../memory/memoryTypes";
import { classifyMemoryCandidate } from "../../memory/silentMemoryWorker";
import type { AikoMemoryRuntime } from "../types";

export type MemoryCandidateExtractor = (transcript: string) => Promise<MemoryCandidate[]>;

export type AikoMemoryAgentOptions = {
  memoryRuntime?: AikoMemoryRuntime;
  memoryCandidateExtractor?: MemoryCandidateExtractor;
};

export type AikoMemoryAgent = {
  recall: (query: string, limit?: number) => Promise<RecalledMemory[]>;
  rememberExchange: (userTranscript: string, assistantText: string) => Promise<void>;
};

// 创建 Memory 子 Agent, 统一处理长期记忆召回和静默整理写入.
export function createAikoMemoryAgent(options: AikoMemoryAgentOptions = {}): AikoMemoryAgent {
  return {
    // 从长期记忆中召回与当前输入相关的内容, 失败时返回空列表.
    async recall(query, limit = 5) {
      if (!options.memoryRuntime || query.trim().length === 0) return [];
      try {
        return await options.memoryRuntime.recall(query, limit);
      } catch {
        return [];
      }
    },

    // 在一轮对话后静默抽取记忆候选, 去重后写入长期记忆 runtime.
    async rememberExchange(userTranscript, _assistantText) {
      if (!options.memoryCandidateExtractor || !options.memoryRuntime || !userTranscript.trim()) return;
      const transcript = `用户:${userTranscript}`;
      try {
        const candidates = await options.memoryCandidateExtractor(transcript);
        for (const candidate of dedupeCandidates(candidates)) {
          await options.memoryRuntime.rememberCandidate(candidate, classifyMemoryCandidate(candidate));
        }
      } catch {
        return;
      }
    }
  };
}

// 对同类型同内容的记忆候选去重, 保留置信度最高的一条.
function dedupeCandidates(candidates: MemoryCandidate[]): MemoryCandidate[] {
  const byKey = new Map<string, MemoryCandidate>();
  for (const candidate of candidates) {
    const content = candidate.content.trim();
    const key = `${candidate.type}:${content.toLowerCase()}`;
    const existing = byKey.get(key);
    if (!existing || candidate.confidence > existing.confidence) {
      byKey.set(key, {
        ...candidate,
        content
      });
    }
  }
  return [...byKey.values()];
}
