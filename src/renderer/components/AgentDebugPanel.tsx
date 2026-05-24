import { useEffect, useMemo, useRef, useState } from "react";
import type { AikoAgentDebugSnapshotDto, AikoTraceRecordDto } from "../../shared/ipcTypes";

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
        <SummaryCard title="Trace" value={snapshot.traces.length} detail={formatLatestTrace(latestTrace)} />
        <SummaryCard title="动作日志" value={snapshot.actionJournal.length} detail={formatLatestAction(snapshot)} />
        <SummaryCard title="Worker" value={snapshot.workers.length} detail={snapshot.workers.map((worker) => worker.name).join(", ")} />
      </div>

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

// 格式化最新 trace 的完成阶段.
function formatLatestTrace(trace: AikoTraceRecordDto | null) {
  if (!trace) return "";
  return trace.events.at(-1)?.name ?? "";
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
  actionJournal: [],
  traces: [],
  workers: []
};
