export type RecalledMemory = {
  id: string;
  type: string;
  content: string;
};

// 根据查询文本从记忆列表中筛选相关记忆.
export function recallMemories(memories: RecalledMemory[], query: string, limit = 5): RecalledMemory[] {
  const terms = buildRecallTerms(query);

  if (terms.length === 0) return [];

  return memories
    .filter((memory) => terms.some((term) => memory.content.toLowerCase().includes(term)))
    .slice(0, limit);
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
