import { useEffect, useMemo, useRef, useState } from "react";
import {
  describeActionRisk,
  describeRollbackStrategy,
  formatRiskLabel
} from "../../shared/actionSafety";
import type {
  AikoActionJournalEntryDto,
  AikoAgentDebugSnapshotDto,
  PendingActionDto
} from "../../shared/ipcTypes";
import {
  buildRestoreHistory,
  createRestoreActionFromAuditEntry,
  extractAuditArtifacts,
  filterAuditEntries,
  filterRestoreHistory,
  type RestoreHistoryItem,
  type AuditResultFilter,
  type AuditRiskFilter,
  type RestoreStatusFilter
} from "./actionAuditHelpers";

type ActionAuditPanelProps = {
  onProposeAction?: (action: PendingActionDto, message?: string) => void;
};

// 渲染本地动作审计面板, 让高风险 Windows 操作有可追踪的产品化入口.
export function ActionAuditPanel({ onProposeAction }: ActionAuditPanelProps) {
  const [snapshot, setSnapshot] = useState<AikoAgentDebugSnapshotDto>(emptySnapshot);
  const [loading, setLoading] = useState(true);
  const [riskFilter, setRiskFilter] = useState<AuditRiskFilter>("all");
  const [capabilityFilter, setCapabilityFilter] = useState("all");
  const [resultFilter, setResultFilter] = useState<AuditResultFilter>("all");
  const [searchText, setSearchText] = useState("");
  const [restoreStatusFilter, setRestoreStatusFilter] = useState<RestoreStatusFilter>("all");
  const [restoreSearchText, setRestoreSearchText] = useState("");
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

  const capabilityOptions = useMemo(
    () => Array.from(new Set(snapshot.actionJournal.map((entry) => entry.capability))).sort(),
    [snapshot.actionJournal]
  );
  const restoreHistory = useMemo(
    () =>
      filterRestoreHistory(buildRestoreHistory(snapshot.actionJournal), {
        status: restoreStatusFilter,
        searchText: restoreSearchText
      }).slice(0, 8),
    [restoreSearchText, restoreStatusFilter, snapshot.actionJournal]
  );
  const filteredEntries = useMemo(
    () =>
      filterAuditEntries(snapshot.actionJournal, {
        risk: riskFilter,
        capability: capabilityFilter,
        result: resultFilter,
        searchText
      })
        .slice(-80)
        .reverse(),
    [capabilityFilter, resultFilter, riskFilter, searchText, snapshot.actionJournal]
  );
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

      {restoreHistory.length > 0 && (
        <section className="panel-section audit-restore-history">
          <div className="audit-section-heading">
            <h3>恢复历史</h3>
            <span>{restoreHistory.length}</span>
          </div>
          <div className="audit-filter-bar audit-restore-filter-bar">
            <label>
              状态
              <select
                aria-label="恢复状态筛选"
                value={restoreStatusFilter}
                onChange={(event) => setRestoreStatusFilter(event.currentTarget.value as RestoreStatusFilter)}
              >
                <option value="all">全部</option>
                <option value="in_trash">待恢复</option>
                <option value="restored">已恢复</option>
              </select>
            </label>
            <label>
              文件
              <input
                aria-label="恢复历史搜索"
                value={restoreSearchText}
                onChange={(event) => setRestoreSearchText(event.currentTarget.value)}
                placeholder="文件名或路径..."
              />
            </label>
          </div>
          <ol className="audit-restore-list">
            {restoreHistory.map((item) => (
              <RestoreHistoryEntry key={item.id} item={item} onProposeAction={onProposeAction} />
            ))}
          </ol>
        </section>
      )}

      <section className="panel-section">
        <div className="audit-section-heading">
          <h3>动作日志</h3>
          <span>
            {filteredEntries.length} / {snapshot.actionJournal.length}
          </span>
        </div>

        <div className="audit-filter-bar">
          <label>
            风险
            <select aria-label="风险筛选" value={riskFilter} onChange={(event) => setRiskFilter(event.currentTarget.value as AuditRiskFilter)}>
              <option value="all">全部</option>
              <option value="low">低风险</option>
              <option value="medium">中风险</option>
              <option value="high">高风险</option>
              <option value="critical">关键风险</option>
            </select>
          </label>
          <label>
            能力
            <select aria-label="能力筛选" value={capabilityFilter} onChange={(event) => setCapabilityFilter(event.currentTarget.value)}>
              <option value="all">全部</option>
              {capabilityOptions.map((capability) => (
                <option key={capability} value={capability}>
                  {capability}
                </option>
              ))}
            </select>
          </label>
          <label>
            结果
            <select aria-label="结果筛选" value={resultFilter} onChange={(event) => setResultFilter(event.currentTarget.value as AuditResultFilter)}>
              <option value="all">全部</option>
              <option value="planned">已规划</option>
              <option value="approval">已审批</option>
              <option value="ok">成功</option>
              <option value="failed">失败</option>
            </select>
          </label>
          <label>
            搜索
            <input
              aria-label="审计搜索"
              value={searchText}
              onChange={(event) => setSearchText(event.currentTarget.value)}
              placeholder="能力, 目标, 输出..."
            />
          </label>
        </div>

        {loading && <p className="panel-muted">正在读取审计日志...</p>}
        {!loading && filteredEntries.length === 0 && <p className="panel-muted">没有匹配当前筛选条件的动作记录.</p>}
        {filteredEntries.length > 0 && (
          <ol className="audit-log-list">
            {filteredEntries.map((entry) => (
              <AuditEntry key={entry.id} entry={entry} onProposeAction={onProposeAction} />
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

// 渲染从 Aiko trash 恢复文件的历史入口.
function RestoreHistoryEntry({
  item,
  onProposeAction
}: {
  item: RestoreHistoryItem;
  onProposeAction?: (action: PendingActionDto, message?: string) => void;
}) {
  const restoreAction = item.restoreAction;

  return (
    <li className={`audit-restore-entry audit-restore-${item.status}`}>
      <div className="audit-restore-head">
        <strong>{item.status === "restored" ? "已恢复" : "待恢复"}</strong>
        <small>{formatRestoreTime(item)}</small>
      </div>
      <dl className="audit-path-grid">
        <div>
          <dt>原路径</dt>
          <dd>{item.originalPath}</dd>
        </div>
        <div>
          <dt>隔离路径</dt>
          <dd>{item.trashPath}</dd>
        </div>
        {item.restoredPath && (
          <div>
            <dt>恢复到</dt>
            <dd>{item.restoredPath}</dd>
          </div>
        )}
      </dl>
      {restoreAction && onProposeAction && (
        <button
          type="button"
          className="audit-restore-button"
          onClick={() => onProposeAction(restoreAction, "我把恢复动作准备好了. 等你确认后再恢复文件.")}
        >
          准备恢复
        </button>
      )}
    </li>
  );
}

// 渲染单条动作审计记录.
function AuditEntry({
  entry,
  onProposeAction
}: {
  entry: AikoActionJournalEntryDto;
  onProposeAction?: (action: PendingActionDto, message?: string) => void;
}) {
  const restoreAction = createRestoreActionFromAuditEntry(entry);
  const artifacts = extractAuditArtifacts(entry);

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
      <div className="audit-state-row">
        <code className={entry.phase === "execution" && entry.ok === false ? "audit-result-failed" : "audit-result-ok"}>
          {formatEntryState(entry)}
        </code>
        {restoreAction && onProposeAction && (
          <button
            type="button"
            className="audit-restore-button"
            onClick={() => onProposeAction(restoreAction, "我把恢复动作准备好了. 等你确认后再恢复文件.")}
          >
            准备恢复
          </button>
        )}
      </div>
      {entry.message && <pre className="audit-entry-message">{entry.message}</pre>}
      {artifacts.length > 0 && (
        <dl className="audit-artifact-list">
          {artifacts.map((artifact) => (
            <div
              key={`${artifact.label}:${artifact.value}`}
              className={`${artifact.label.includes("输出") || artifact.label === "退出码" ? "audit-shell-artifact " : ""}audit-artifact-${artifact.tone ?? "neutral"}`}
            >
              <dt>{artifact.label}</dt>
              <dd>{artifact.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </li>
  );
}

// 格式化恢复历史时间, 优先展示恢复时间.
function formatRestoreTime(item: RestoreHistoryItem) {
  const value = item.restoredAt ?? item.deletedAt;
  return value ? new Date(value).toLocaleString() : "未知时间";
}

// 格式化审计记录当前阶段和结果.
function formatEntryState(entry: AikoActionJournalEntryDto) {
  if (entry.phase === "approval") return `${entry.phase}:${entry.decision ?? "pending"}`;
  if (entry.phase === "execution") return `${entry.phase}:${entry.ok ? "ok" : "failed"}`;
  return `${entry.phase}:${entry.source ?? "agent"}`;
}

const emptySnapshot: AikoAgentDebugSnapshotDto = {
  runs: [],
  statuses: [],
  experienceSignals: [],
  actionJournal: [],
  traces: [],
  workers: [],
  workerRuns: []
};
