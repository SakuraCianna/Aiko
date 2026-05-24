export type RecalledMemory = {
  id: string;
  type: string;
  content: string;
};

export type MemoryVector = Record<string, number>;

// 根据查询文本从记忆列表中筛选相关记忆.
export function recallMemories(memories: RecalledMemory[], query: string, limit = 5): RecalledMemory[] {
  const terms = buildRecallTerms(query);

  if (terms.length === 0) return [];

  return memories
    .filter((memory) => terms.some((term) => memory.content.toLowerCase().includes(term)))
    .slice(0, limit);
}

// 根据本地文本向量对记忆进行排序, 没有有效向量时降级到关键词召回.
export function rankMemoriesByVector(
  memories: Array<RecalledMemory & { vector?: MemoryVector | null }>,
  query: string,
  limit = 5
): RecalledMemory[] {
  const queryVector = createMemoryVector(query);
  if (Object.keys(queryVector).length === 0) return [];

  const ranked = memories
    .map((memory, index) => ({
      memory,
      index,
      score: scoreMemoryVector(queryVector, memory.vector ?? createMemoryVector(memory.content))
    }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, limit)
    .map(({ memory }) => ({
      id: memory.id,
      type: memory.type,
      content: memory.content
    }));

  return ranked.length > 0 ? ranked : recallMemories(memories, query, limit);
}

// 为中英文记忆内容构建轻量本地向量, 后续可替换为真实 embedding.
export function createMemoryVector(text: string): MemoryVector {
  const terms = buildRecallTerms(text);
  const vector: MemoryVector = {};
  for (const term of terms) {
    vector[term] = (vector[term] ?? 0) + 1;
  }
  return normalizeVector(vector);
}

// 为中英文查询构造可匹配的召回关键词.
function buildRecallTerms(query: string): string[] {
  const normalized = query.toLowerCase().trim();
  if (!normalized) return [];

  const terms = new Set(
    normalized
      .split(/\s+/)
      .map((term) => term.trim())
      .filter((term) => term.length >= 2)
  );

  const cjkRuns = normalized.match(/\p{Script=Han}+/gu) ?? [];
  for (const run of cjkRuns) {
    for (let index = 0; index < run.length - 1; index += 1) {
      terms.add(run.slice(index, index + 2));
    }
  }

  return [...terms];
}

// 计算两个稀疏向量的余弦相似度.
function scoreMemoryVector(queryVector: MemoryVector, memoryVector: MemoryVector): number {
  let score = 0;
  for (const [term, weight] of Object.entries(queryVector)) {
    score += weight * (memoryVector[term] ?? 0);
  }
  return score;
}

// 把词频向量归一化, 让长记忆不会天然压过短记忆.
function normalizeVector(vector: MemoryVector): MemoryVector {
  const length = Math.sqrt(Object.values(vector).reduce((sum, value) => sum + value * value, 0));
  if (length === 0) return vector;
  return Object.fromEntries(Object.entries(vector).map(([term, value]) => [term, value / length]));
}
