import { Check, Circle, Loader2, XCircle } from "lucide-react";
import type { AikoTaskCard, AikoTaskStepStatus } from "../task/taskStatusModel";

type TaskStatusCardProps = {
  card: AikoTaskCard | null;
};

// 渲染用户视角的任务进度卡片, 让多步骤操作不只停留在调试面板里.
export function TaskStatusCard({ card }: TaskStatusCardProps) {
  if (!card) return null;

  return (
    <aside className={`task-status-card task-status-${card.status}`} aria-live="polite">
      <div className="task-status-head">
        <strong>{card.title}</strong>
        <span>{card.currentStep}</span>
      </div>
      <p>{card.detail}</p>
      <ol className="task-status-steps">
        {card.steps.map((step) => (
          <li key={step.id} className={`task-step-${step.status}`}>
            <TaskStepIcon status={step.status} />
            <span>{step.label}</span>
          </li>
        ))}
      </ol>
    </aside>
  );
}

// 根据步骤状态选择紧凑图标, 避免用大段文字解释运行过程.
function TaskStepIcon({ status }: { status: AikoTaskStepStatus }) {
  if (status === "completed") return <Check size={13} />;
  if (status === "failed" || status === "cancelled") return <XCircle size={13} />;
  if (status === "running" || status === "waiting") return <Loader2 size={13} />;
  return <Circle size={12} />;
}
