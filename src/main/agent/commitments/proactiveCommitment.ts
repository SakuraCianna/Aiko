import type { AikoProactiveMessage } from "../../../shared/ipcTypes";
import type { AikoCommitment } from "./commitmentService";

// 把到期承诺转换为渲染层可以直接展示和播报的主动消息.
export function createCommitmentProactiveMessage(
  commitment: AikoCommitment,
  now = new Date()
): AikoProactiveMessage {
  const createdAt = now.toISOString();
  return {
    id: `proactive_${commitment.id}_${createdAt}`,
    kind: "commitment",
    commitmentId: commitment.id,
    createdAt,
    message: formatCommitmentFollowUp(commitment.summary)
  };
}

// 生成 Aiko 风格的轻量 follow-up 文案, 只复述承诺本身, 不伪造进展.
export function formatCommitmentFollowUp(summary: string): string {
  const trimmed = summary.trim();
  return trimmed
    ? `我想起你之前提到过: ${trimmed}。需要我现在帮你整理一下下一步吗?`
    : "我想起之前有一件需要跟进的小事。需要我现在帮你整理一下吗?";
}
