import type { AikoAgentStatusEventDto } from "../../shared/ipcTypes";

export type AikoTaskCardStatus = "running" | "waiting_approval" | "completed" | "failed" | "cancelled";
export type AikoTaskStepStatus = "pending" | "running" | "waiting" | "completed" | "failed" | "cancelled";

export type AikoTaskStep = {
  id: string;
  label: string;
  status: AikoTaskStepStatus;
};

export type AikoTaskCard = {
  id: string;
  runId?: string;
  requestId?: string;
  title: string;
  status: AikoTaskCardStatus;
  currentStep: string;
  detail: string;
  steps: AikoTaskStep[];
  updatedAt: string;
};

type StepDefinition = {
  id: string;
  label: string;
  phases: AikoAgentStatusEventDto["phase"][];
};

const TASK_STEPS: StepDefinition[] = [
  { id: "accepted", label: "接收请求", phases: ["accepted", "running"] },
  { id: "retrieval", label: "整理上下文", phases: ["retrieving"] },
  { id: "planning", label: "规划步骤", phases: ["planning", "model_generating"] },
  { id: "action", label: "准备安全动作", phases: ["preparing_action", "waiting_approval", "action_executing"] },
  { id: "memory", label: "整理记忆", phases: ["memory_writing"] },
  { id: "finish", label: "完成收尾", phases: ["completed", "failed", "cancelled"] }
];

const PHASE_TITLES: Record<AikoAgentStatusEventDto["phase"], string> = {
  accepted: "收到请求",
  running: "开始处理",
  retrieving: "整理上下文",
  planning: "拆解步骤",
  preparing_action: "准备安全动作",
  waiting_approval: "等待你确认",
  model_generating: "生成回复",
  memory_writing: "整理长期记忆",
  action_executing: "执行本地动作",
  completed: "任务完成",
  failed: "任务遇到问题",
  cancelled: "任务已中止"
};

// 把主进程 agent 生命周期事件压缩成桌宠窗口上的用户可见任务卡片.
export function reduceTaskCardFromAgentStatus(
  current: AikoTaskCard | null,
  status: AikoAgentStatusEventDto
): AikoTaskCard | null {
  if (current && status.runId && current.runId && status.runId !== current.runId) return current;
  if (current && status.requestId && current.requestId && status.requestId !== current.requestId) return current;

  const stepIndex = Math.max(0, TASK_STEPS.findIndex((step) => step.phases.includes(status.phase)));
  const cardStatus = mapCardStatus(status.phase);
  const currentStep = TASK_STEPS[stepIndex]?.label ?? "处理中";

  return {
    id: current?.id ?? status.runId ?? status.requestId ?? crypto.randomUUID(),
    runId: status.runId ?? current?.runId,
    requestId: status.requestId ?? current?.requestId,
    title: PHASE_TITLES[status.phase],
    status: cardStatus,
    currentStep,
    detail: status.message,
    steps: TASK_STEPS.map((step, index) => ({
      id: step.id,
      label: step.label,
      status: mapStepStatus(index, stepIndex, status.phase)
    })),
    updatedAt: status.createdAt
  };
}

// 本地中止或本地 UI 状态变化没有主进程事件时, 仍然让任务卡片同步收尾.
export function markTaskCardCancelled(current: AikoTaskCard | null, updatedAt = new Date().toISOString()): AikoTaskCard | null {
  if (!current) return null;
  return {
    ...current,
    title: "任务已中止",
    status: "cancelled",
    currentStep: "完成收尾",
    detail: "Aiko 已停止当前输出.",
    steps: current.steps.map((step, index, steps) => ({
      ...step,
      status: index === steps.length - 1 ? "cancelled" : step.status === "pending" ? "cancelled" : step.status
    })),
    updatedAt
  };
}

// 判断任务卡片是否已经进入终态, 用于稍后自动淡出.
export function isTaskCardTerminal(card: AikoTaskCard | null) {
  return Boolean(card && ["completed", "failed", "cancelled"].includes(card.status));
}

// 把 agent phase 映射成卡片整体状态.
function mapCardStatus(phase: AikoAgentStatusEventDto["phase"]): AikoTaskCardStatus {
  if (phase === "waiting_approval") return "waiting_approval";
  if (phase === "completed") return "completed";
  if (phase === "failed") return "failed";
  if (phase === "cancelled") return "cancelled";
  return "running";
}

// 根据当前步骤位置给每个步骤标注 pending, running, waiting 或终态.
function mapStepStatus(
  index: number,
  currentIndex: number,
  phase: AikoAgentStatusEventDto["phase"]
): AikoTaskStepStatus {
  if (phase === "failed" && index === currentIndex) return "failed";
  if (phase === "cancelled" && index === currentIndex) return "cancelled";
  if (phase === "completed") return "completed";
  if (index < currentIndex) return "completed";
  if (index > currentIndex) return "pending";
  if (phase === "waiting_approval") return "waiting";
  return "running";
}
