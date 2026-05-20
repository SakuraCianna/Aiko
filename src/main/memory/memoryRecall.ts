export type RecalledMemory = {
  id: string;
  type: string;
  content: string;
};

export function recallMemories(memories: RecalledMemory[], query: string, limit = 5): RecalledMemory[] {
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .map((term) => term.trim())
    .filter(Boolean);

  if (terms.length === 0) return [];

  return memories
    .filter((memory) => terms.some((term) => memory.content.toLowerCase().includes(term)))
    .slice(0, limit);
}
