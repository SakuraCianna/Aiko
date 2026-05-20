import type { MemoryCandidate, MemoryStatus } from "./memoryTypes";

export type StoredMemoryCandidate = MemoryCandidate & {
  id: string;
  status: MemoryStatus;
  createdAt: string;
};

export class MemoryRepository {
  private candidates: StoredMemoryCandidate[] = [];

  insertMemoryCandidate(candidate: MemoryCandidate, status: MemoryStatus): StoredMemoryCandidate {
    const stored = {
      ...candidate,
      id: `memory_candidate_${crypto.randomUUID()}`,
      status,
      createdAt: new Date().toISOString()
    };
    this.candidates.push(stored);
    return stored;
  }

  listCandidates(): StoredMemoryCandidate[] {
    return [...this.candidates];
  }
}
