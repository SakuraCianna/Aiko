import { useEffect, useState } from "react";
import type { MemorySnapshotDto } from "../../shared/ipcTypes";

type MemoryPanelProps = {
  onStatus: (message: string) => void;
};

// 渲染记忆管理面板, 支持查看和确认记忆候选.
export function MemoryPanel({ onStatus }: MemoryPanelProps) {
  const [snapshot, setSnapshot] = useState<MemorySnapshotDto>({ memories: [], pendingCandidates: [] });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void refresh();
  }, []);

  // 从主进程刷新记忆快照.
  async function refresh() {
    setLoading(true);
    try {
      setSnapshot(await window.aiko.listMemory());
    } finally {
      setLoading(false);
    }
  }

  // 接受一个待确认记忆候选.
  async function accept(candidateId: string) {
    const result = await window.aiko.acceptMemoryCandidate(candidateId);
    onStatus(result.message);
    await refresh();
  }

  // 忽略一个待确认记忆候选.
  async function reject(candidateId: string) {
    const result = await window.aiko.rejectMemoryCandidate(candidateId);
    onStatus(result.message);
    await refresh();
  }

  return (
    <section className="panel-content memory-panel">
      <div className="panel-section">
        <h3>待确认记忆</h3>
        {loading && <p className="panel-muted">正在读取...</p>}
        {!loading && snapshot.pendingCandidates.length === 0 && <p className="panel-muted">暂无待确认记忆.</p>}
        {snapshot.pendingCandidates.map((candidate) => (
          <article key={candidate.id} className="memory-card">
            <div>
              <strong>{candidate.type}</strong>
              <p>{candidate.content}</p>
              <span>置信度 {Math.round(candidate.confidence * 100)}%</span>
            </div>
            <div className="memory-card-actions">
              <button type="button" onClick={() => void accept(candidate.id)}>
                接受
              </button>
              <button type="button" onClick={() => void reject(candidate.id)}>
                忽略
              </button>
            </div>
          </article>
        ))}
      </div>

      <div className="panel-section">
        <h3>长期记忆</h3>
        {!loading && snapshot.memories.length === 0 && <p className="panel-muted">还没有长期记忆.</p>}
        {snapshot.memories.map((memory) => (
          <article key={memory.id} className="memory-card">
            <div>
              <strong>{memory.type}</strong>
              <p>{memory.content}</p>
              <span>置信度 {Math.round(memory.confidence * 100)}%</span>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
