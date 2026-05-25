import { useEffect, useMemo, useRef, useState } from "react";
import type {
  AikoAgentDebugSnapshotDto,
  AikoAgentStatusEventDto,
  AikoExperienceSignalDto,
  AikoTraceRecordDto
} from "../../shared/ipcTypes";

const IMPORTANT_STEPS = [
  "retriever.completed",
  "planner.completed",
  "model_generate.completed",
  "postprocess.completed",
  "memory_commit.completed",
  "approval_resume",
  "tool_execute",
  "request.completed"
];

// 渲染 Agent 调试快照, 方便测试时观察请求 trace, 工具日志和 worker 边界.
export function AgentDebugPanel() {
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

  const latestTrace = useMemo(() => snapshot.traces.at(-1) ?? null, [snapshot.traces]);

  // 从主进程读取最新 Agent 调试快照, 并防止过期异步请求覆盖新状态.
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
    <section className="panel-content agent-debug-panel">
      <div className="conversation-toolbar">
        <div>
          <h3>Agent 运行链路</h3>
          <p className="panel-muted">查看最近请求的生命周期, LangGraph task, 工具审批和 worker 边界.</p>
        </div>
        <button type="button" onClick={() => void refresh()}>
          刷新
        </button>
      </div>

      {loading && <p className="panel-muted">正在读取...</p>}

      <div className="agent-debug-grid">
        <SummaryCard title="运行" value={snapshot.runs.length} detail={formatLatestRun(snapshot)} />
        <SummaryCard title="状态" value={snapshot.statuses.length} detail={formatLatestStatus(snapshot)} />
        <SummaryCard title="体验" value={snapshot.experienceSignals.length} detail={formatLatestExperienceSignal(snapshot)} />
        <SummaryCard title="Trace" value={snapshot.traces.length} detail={formatLatestTrace(latestTrace)} />
        <SummaryCard title="动作日志" value={snapshot.actionJournal.length} detail={formatLatestAction(snapshot)} />
        <SummaryCard title="Worker" value={snapshot.workers.length} detail={snapshot.workers.map((worker) => worker.name).join(", ")} />
      </div>

      <section className="panel-section">
        <h3>Agent 状态时间线</h3>
        {snapshot.statuses.length === 0 && <p className="panel-muted">还没有状态事件.</p>}
        {snapshot.statuses.length > 0 && (
          <ol className="agent-step-list">
            {snapshot.statuses.slice(-10).reverse().map((status) => (
              <li key={`${status.createdAt}-${status.phase}-${status.runId ?? ""}`}>
                <span>{status.phase}</span>
                <small>{new Date(status.createdAt).toLocaleTimeString()}</small>
                <code>{formatAgentStatus(status)}</code>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="panel-section">
        <h3>体验信号</h3>
        {snapshot.experienceSignals.length === 0 && <p className="panel-muted">还没有隐式体验信号.</p>}
        {snapshot.experienceSignals.slice(-6).reverse().map((signal) => (
          <article key={signal.id} className="agent-debug-card">
            <strong>{signal.satisfaction} / {signal.aspect}</strong>
            <p>{formatExperienceSignal(signal)}</p>
            <span>{new Date(signal.createdAt).toLocaleTimeString()}</span>
          </article>
        ))}
      </section>

      <section className="panel-section">
        <h3>最近 Trace</h3>
        {!latestTrace && <p className="panel-muted">还没有 trace 记录.</p>}
        {latestTrace && (
          <ol className="agent-step-list">
            {latestTrace.events.map((event) => (
              <li key={`${event.at}-${event.name}`} className={IMPORTANT_STEPS.includes(event.name) ? "important-step" : ""}>
                <span>{event.name}</span>
                <small>{new Date(event.at).toLocaleTimeString()}</small>
                {event.data && <code>{formatEventData(event.data)}</code>}
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="panel-section">
        <h3>最近动作</h3>
        {snapshot.actionJournal.length === 0 && <p className="panel-muted">还没有本地动作日志.</p>}
        {snapshot.actionJournal.slice(-6).reverse().map((entry) => (
          <article key={entry.id} className="agent-debug-card">
            <strong>{entry.phase}</strong>
            <p>{entry.capability} / {entry.target}</p>
            <span>{entry.decision ?? entry.ok ?? entry.source ?? "pending"}</span>
          </article>
        ))}
      </section>
    </section>
  );
}

// 渲染一个紧凑的调试指标卡.
function SummaryCard({ title, value, detail }: { title: string; value: number; detail: string }) {
  return (
    <article className="agent-debug-card">
      <span>{title}</span>
      <strong>{value}</strong>
      <p>{detail || "暂无记录"}</p>
    </article>
  );
}

// 格式化最新运行状态.
function formatLatestRun(snapshot: AikoAgentDebugSnapshotDto) {
  const run = snapshot.runs.at(-1);
  if (!run) return "";
  return `${run.status}: ${run.userText}`;
}

// 格式化最新 Agent 状态, 用于概览卡片.
function formatLatestStatus(snapshot: AikoAgentDebugSnapshotDto) {
  const status = snapshot.statuses.at(-1);
  if (!status) return "";
  return `${status.phase}: ${status.message}`;
}

// 格式化最新隐式体验信号, 用于观察 Aiko 是否捕捉到用户语气变化.
function formatLatestExperienceSignal(snapshot: AikoAgentDebugSnapshotDto) {
  const signal = snapshot.experienceSignals.at(-1);
  if (!signal) return "";
  return `${signal.satisfaction}: ${signal.recommendation}`;
}

// 格式化最新 trace 的完成阶段.
function formatLatestTrace(trace: AikoTraceRecordDto | null) {
  if (!trace) return "";
  return trace.events.at(-1)?.name ?? "";
}

// 格式化单条 Agent 状态事件, 展示 message 和少量 detail.
function formatAgentStatus(status: AikoAgentStatusEventDto) {
  const detail = status.detail ? ` ${formatEventData(status.detail)}` : "";
  return `${status.message}${detail}`;
}

// 格式化隐式体验信号, 避免把用户原文完整铺满调试面板.
function formatExperienceSignal(signal: AikoExperienceSignalDto) {
  return `${signal.summary} ${signal.recommendation}`.trim();
}

// 格式化最新本地动作日志.
function formatLatestAction(snapshot: AikoAgentDebugSnapshotDto) {
  const entry = snapshot.actionJournal.at(-1);
  if (!entry) return "";
  return `${entry.phase}: ${entry.capability}`;
}

// 限制 data 展示长度, 防止大对象撑坏面板布局.
function formatEventData(data: Record<string, unknown>) {
  const text = JSON.stringify(data);
  return text.length <= 160 ? text : `${text.slice(0, 160)}...`;
}

const emptySnapshot: AikoAgentDebugSnapshotDto = {
  runs: [],
  statuses: [],
  experienceSignals: [],
  actionJournal: [],
  traces: [],
  workers: []
};
