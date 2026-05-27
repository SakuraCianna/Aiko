import { useEffect, useRef, useState } from "react";
import {
  describeActionRisk,
  describeRollbackStrategy,
  formatRiskLabel
} from "../../shared/actionSafety";
import type { AikoActionJournalEntryDto, AikoAgentDebugSnapshotDto } from "../../shared/ipcTypes";

// 渲染本地动作审计面板, 让高风险 Windows 操作有可追踪的产品化入口.
export function ActionAuditPanel() {
  const [snapshot, setSnapshot] = useState<AikoAgentDebugSnapshotDto>(emptySnapshot);
  const [loading, setLoading] = useState(true);
  const mountedRef = useRef(true);
  const refreshSeqRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    void refresh();
    return () => {
      mountedRef.current = false;
      refreshSeqRef.current += 1;
    };
  }, []);

  const entries = snapshot.actionJournal.slice(-40).reverse();
  const highRiskCount = snapshot.actionJournal.filter((entry) => entry.risk === "high").length;
  const failedCount = snapshot.actionJournal.filter((entry) => entry.phase === "execution" && entry.ok === false).length;

  // 从主进程读取最新审计快照, 并防止旧请求覆盖新状态.
  async function refresh() {
    const refreshId = refreshSeqRef.current + 1;
    refreshSeqRef.current = refreshId;
    if (mountedRef.current) setLoading(true);

    try {
      const nextSnapshot = await window.aiko.getAgentDebugSnapshot();
      if (mountedRef.current && refreshSeqRef.current === refreshId) {
        setSnapshot(nextSnapshot);
      }
    } finally {
      if (mountedRef.current && refreshSeqRef.current === refreshId) {
        setLoading(false);
      }
    }
  }

  return (
    <section className="panel-content audit-panel">
      <div className="conversation-toolbar">
        <div>
          <h3>动作审计</h3>
          <p className="panel-muted">查看本地动作的规划, 审批, 执行结果和回滚提示.</p>
        </div>
        <button type="button" onClick={() => void refresh()}>
          刷新
        </button>
      </div>

      <div className="audit-summary-grid">
        <SummaryCard title="总记录" value={snapshot.actionJournal.length} />
        <SummaryCard title="高风险" value={highRiskCount} />
        <SummaryCard title="失败执行" value={failedCount} />
      </div>

      <section className="panel-section">
        <h3>最近动作</h3>
        {loading && <p className="panel-muted">正在读取审计日志...</p>}
        {!loading && entries.length === 0 && <p className="panel-muted">还没有本地动作审计记录.</p>}
        {entries.length > 0 && (
          <ol className="audit-log-list">
            {entries.map((entry) => (
              <AuditEntry key={entry.id} entry={entry} />
            ))}
          </ol>
        )}
      </section>
    </section>
  );
}

// 渲染审计摘要卡片.
function SummaryCard({ title, value }: { title: string; value: number }) {
  return (
    <article className="agent-debug-card">
      <span>{title}</span>
      <strong>{value}</strong>
    </article>
  );
}

// 渲染单条动作审计记录.
function AuditEntry({ entry }: { entry: AikoActionJournalEntryDto }) {
  return (
    <li className={`audit-log-entry audit-risk-${entry.risk}`}>
      <div className="audit-log-main">
        <span className="risk-badge">{formatRiskLabel(entry.risk)}</span>
        <strong>{entry.capability}</strong>
        <small>{new Date(entry.createdAt).toLocaleString()}</small>
      </div>
      <p>{entry.target}</p>
      <p>{describeActionRisk(entry)}</p>
      <p className="rollback-note">{describeRollbackStrategy(entry)}</p>
      <code>{formatEntryState(entry)}</code>
    </li>
  );
}

// 格式化审计记录当前阶段和结果.
function formatEntryState(entry: AikoActionJournalEntryDto) {
  if (entry.phase === "approval") return `${entry.phase}:${entry.decision ?? "pending"}`;
  if (entry.phase === "execution") return `${entry.phase}:${entry.ok ? "ok" : "failed"} ${entry.message ?? ""}`.trim();
  return `${entry.phase}:${entry.source ?? "agent"}`;
}

const emptySnapshot: AikoAgentDebugSnapshotDto = {
  runs: [],
  statuses: [],
  experienceSignals: [],
  actionJournal: [],
  traces: [],
  workers: []
};
