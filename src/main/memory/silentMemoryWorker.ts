import type { MemoryCandidate, MemoryStatus } from "./memoryTypes";

const MAX_MEMORY_CANDIDATE_CONTENT_LENGTH = 800;
const confirmationTypes = new Set<MemoryCandidate["type"]>(["reminder", "permission", "sensitive"]);
const memoryTypes = new Set<MemoryCandidate["type"]>([
  "preference",
  "relationship",
  "habit",
  "software",
  "recent_event",
  "reminder",
  "permission",
  "sensitive"
]);

// 根据置信度和敏感类型决定记忆候选的保存状态.
export function classifyMemoryCandidate(candidate: MemoryCandidate): MemoryStatus {
  if (candidate.confidence < 0.65) return "rejected";
  if (candidate.requiresConfirmation) return "pending_confirmation";
  if (confirmationTypes.has(candidate.type)) return "pending_confirmation";
  return "accepted";
}

// 调用模型抽取记忆候选, 并过滤不可信的结构化输出.
export async function extractMemoryCandidates(
  transcript: string,
  askModel: (prompt: string) => Promise<string>
): Promise<MemoryCandidate[]> {
  const raw = await askModel(transcript);
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) return [];

  // 模型输出先按不可信数据处理, 通过校验后才能进入长期记忆.
  return parsed.filter(isMemoryCandidate).map((item) => ({
    ...item,
    content: item.content.trim()
  }));
}

// 判断未知对象是否是合法的记忆候选.
function isMemoryCandidate(item: unknown): item is MemoryCandidate {
  if (!item || typeof item !== "object") return false;
  const candidate = item as Partial<MemoryCandidate>;
  return (
    typeof candidate.type === "string" &&
    memoryTypes.has(candidate.type as MemoryCandidate["type"]) &&
    typeof candidate.content === "string" &&
    candidate.content.trim().length > 0 &&
    candidate.content.trim().length <= MAX_MEMORY_CANDIDATE_CONTENT_LENGTH &&
    typeof candidate.confidence === "number" &&
    Number.isFinite(candidate.confidence) &&
    candidate.confidence >= 0 &&
    candidate.confidence <= 1 &&
    typeof candidate.requiresConfirmation === "boolean"
  );
}
