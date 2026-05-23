import { useEffect, useRef, useState } from "react";
import type { ConversationSnapshotDto } from "../../shared/ipcTypes";

// 渲染当前短期对话上下文, 并提供开启新对话的入口.
export function ChatPanel() {
  const [snapshot, setSnapshot] = useState<ConversationSnapshotDto>({
    messages: [],
    maxMessages: 0,
    maxContextChars: 0
  });
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("");
  const mountedRef = useRef(true);
  const refreshSeqRef = useRef(0);

  useEffect(() => {
    void refresh();

    return () => {
      mountedRef.current = false;
      refreshSeqRef.current += 1;
    };
  }, []);

  // 从主进程读取当前短期上下文快照.
  async function refresh() {
    const refreshId = refreshSeqRef.current + 1;
    refreshSeqRef.current = refreshId;
    if (mountedRef.current) setLoading(true);

    try {
      const nextSnapshot = await window.aiko.listConversation();
      if (mountedRef.current && refreshSeqRef.current === refreshId) {
        setSnapshot(nextSnapshot);
      }
    } finally {
      if (mountedRef.current && refreshSeqRef.current === refreshId) {
        setLoading(false);
      }
    }
  }

  // 清空当前短期上下文, 长期记忆不受影响.
  async function resetConversation() {
    const nextSnapshot = await window.aiko.resetConversation();
    if (!mountedRef.current) return;
    setSnapshot(nextSnapshot);
    setStatus("已开启新对话. 长期记忆仍然保留.");
  }

  return (
    <section className="panel-content conversation-panel">
      <div className="conversation-toolbar">
        <div>
          <h3>当前对话上下文</h3>
          <p className="panel-muted">
            最近 {snapshot.maxMessages || 12} 条消息会参与本轮连续对话, 长期记忆在记忆页单独管理.
          </p>
        </div>
        <button type="button" onClick={() => void resetConversation()}>
          开启新对话
        </button>
      </div>

      {status && <p className="panel-muted">{status}</p>}
      {loading && <p className="panel-muted">正在读取...</p>}
      {!loading && snapshot.messages.length === 0 && <p className="panel-muted">当前没有短期上下文.</p>}
      {snapshot.messages.map((message) => (
        <article key={`${message.createdAt}-${message.role}-${message.content}`} className="conversation-card">
          <strong>{message.role === "user" ? "用户" : "Aiko"}</strong>
          <p>{message.content}</p>
          <span>{new Date(message.createdAt).toLocaleString()}</span>
        </article>
      ))}
    </section>
  );
}
