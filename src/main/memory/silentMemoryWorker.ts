import type { MemoryCandidate, MemoryStatus } from "./memoryTypes";

const confirmationTypes = new Set<MemoryCandidate["type"]>(["reminder", "permission", "sensitive"]);

export function classifyMemoryCandidate(candidate: MemoryCandidate): MemoryStatus {
  if (candidate.confidence < 0.65) return "rejected";
  if (candidate.requiresConfirmation) return "pending_confirmation";
  if (confirmationTypes.has(candidate.type)) return "pending_confirmation";
  return "accepted";
}

export async function extractMemoryCandidates(
  transcript: string,
  askModel: (prompt: string) => Promise<string>
): Promise<MemoryCandidate[]> {
  const raw = await askModel(transcript);
  const parsed = JSON.parse(raw) as MemoryCandidate[];
  return parsed.filter((item) => typeof item.content === "string" && item.content.trim().length > 0);
}
