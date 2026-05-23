import { CheckCircle2, RefreshCw, Trash2, XCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ReminderItemDto, ReminderSnapshotDto, ReminderStatusDto } from "../../shared/ipcTypes";

type ReminderPanelProps = {
  onStatus: (message: string) => void;
};

// 渲染本地提醒面板, 支持查看, 完成, 取消和删除提醒.
export function ReminderPanel({ onStatus }: ReminderPanelProps) {
  const [snapshot, setSnapshot] = useState<ReminderSnapshotDto>({ reminders: [] });
  const [loading, setLoading] = useState(true);
  const mountedRef = useRef(true);
  const refreshSeqRef = useRef(0);

  useEffect(() => {
    void refresh();

    return () => {
      mountedRef.current = false;
      refreshSeqRef.current += 1;
    };
  }, []);

  // 从主进程刷新提醒列表.
  async function refresh() {
    const refreshId = refreshSeqRef.current + 1;
    refreshSeqRef.current = refreshId;
    if (mountedRef.current) setLoading(true);

    try {
      const nextSnapshot = await window.aiko.listReminders();
      if (mountedRef.current && refreshSeqRef.current === refreshId) {
        setSnapshot(nextSnapshot);
      }
    } finally {
      if (mountedRef.current && refreshSeqRef.current === refreshId) {
        setLoading(false);
      }
    }
  }

  // 更新单条提醒状态并刷新列表.
  async function updateStatus(reminderId: string, status: ReminderStatusDto) {
    const result = await window.aiko.updateReminderStatus(reminderId, status);
    if (!mountedRef.current) return;
    onStatus(result.message);
    await refresh();
  }

  // 删除单条提醒并刷新列表.
  async function deleteReminder(reminderId: string) {
    const result = await window.aiko.deleteReminder(reminderId);
    if (!mountedRef.current) return;
    onStatus(result.message);
    await refresh();
  }

  return (
    <section className="panel-content reminder-panel">
      <div className="reminder-toolbar">
        <div>
          <h3>本地提醒</h3>
          <p className="panel-muted">这些提醒保存在本机, 可以被 Aiko 的本地动作直接读写.</p>
        </div>
        <button type="button" onClick={() => void refresh()} title="刷新提醒" aria-label="刷新提醒">
          <RefreshCw />
        </button>
      </div>

      {loading && <p className="panel-muted">正在读取提醒...</p>}
      {!loading && snapshot.reminders.length === 0 && <p className="panel-muted">还没有提醒</p>}

      <div className="reminder-list">
        {snapshot.reminders.map((reminder) => (
          <ReminderCard
            key={reminder.id}
            reminder={reminder}
            onComplete={() => void updateStatus(reminder.id, "completed")}
            onCancel={() => void updateStatus(reminder.id, "cancelled")}
            onDelete={() => void deleteReminder(reminder.id)}
          />
        ))}
      </div>
    </section>
  );
}

type ReminderCardProps = {
  reminder: ReminderItemDto;
  onComplete: () => void;
  onCancel: () => void;
  onDelete: () => void;
};

// 渲染单条提醒, 把状态和常用操作放在同一视线范围内.
function ReminderCard({ reminder, onComplete, onCancel, onDelete }: ReminderCardProps) {
  const canClose = reminder.status === "active" || reminder.status === "paused";

  return (
    <article className="reminder-card">
      <div className="reminder-main">
        <div className="reminder-title-row">
          <strong>{reminder.title}</strong>
          <span className={`reminder-status status-${reminder.status}`}>{statusLabel(reminder.status)}</span>
        </div>
        <span>{formatReminderTime(reminder.triggerAt)}</span>
      </div>
      <div className="reminder-card-actions">
        {canClose && (
          <>
            <button type="button" onClick={onComplete} title="标记完成" aria-label="标记完成">
              <CheckCircle2 />
            </button>
            <button type="button" onClick={onCancel} title="取消提醒" aria-label="取消提醒">
              <XCircle />
            </button>
          </>
        )}
        <button type="button" onClick={onDelete} title="删除提醒" aria-label="删除提醒">
          <Trash2 />
        </button>
      </div>
    </article>
  );
}

// 把提醒状态转换成面板里的简短中文标签.
function statusLabel(status: ReminderStatusDto) {
  if (status === "active") return "等待中";
  if (status === "paused") return "已暂停";
  if (status === "completed") return "已完成";
  return "已取消";
}

// 把 ISO 时间格式化为本机区域时间.
function formatReminderTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}
