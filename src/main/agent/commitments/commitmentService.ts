import { randomUUID } from "node:crypto";

export type AikoCommitmentStatus = "active" | "completed" | "cancelled";
export type AikoCommitmentKind = "follow_up";

export type AikoCommitment = {
  id: string;
  kind: AikoCommitmentKind;
  summary: string;
  sourceText: string;
  dueAt: string;
  status: AikoCommitmentStatus;
  createdAt: string;
};

export type AikoCommitmentServiceOptions = {
  idFactory?: () => string;
  now?: () => Date;
  maxRecords?: number;
};

export type AikoCommitmentService = ReturnType<typeof createAikoCommitmentService>;

// 创建轻量承诺服务, 用于记录对话中推断出的后续关心事项.
export function createAikoCommitmentService(options: AikoCommitmentServiceOptions = {}) {
  const idFactory = options.idFactory ?? (() => `commitment_${randomUUID()}`);
  const now = options.now ?? (() => new Date());
  const maxRecords = options.maxRecords ?? 100;
  const commitments: AikoCommitment[] = [];

  return {
    // 从一轮对话中提取软性 follow-up, 不替代精确提醒工具.
    captureFromExchange(userTranscript: string, _assistantText: string) {
      const captured = extractCommitments(userTranscript, now, idFactory);
      for (const commitment of captured) {
        commitments.push(commitment);
      }
      trimCommitments(commitments, maxRecords);
      return captured.map(cloneCommitment);
    },

    // 列出所有承诺快照.
    list() {
      return commitments.map(cloneCommitment);
    },

    // 列出已经到期且仍然活跃的承诺.
    listDue(at = now()) {
      const timestamp = at.getTime();
      return commitments
        .filter((commitment) => commitment.status === "active" && new Date(commitment.dueAt).getTime() <= timestamp)
        .map(cloneCommitment);
    },

    // 标记承诺已完成.
    complete(commitmentId: string) {
      return updateCommitmentStatus(commitments, commitmentId, "completed");
    },

    // 标记承诺已取消.
    cancel(commitmentId: string) {
      return updateCommitmentStatus(commitments, commitmentId, "cancelled");
    }
  };
}

// 提取非常保守的 follow-up 信号, 避免把普通聊天误判成提醒.
function extractCommitments(userTranscript: string, now: () => Date, idFactory: () => string): AikoCommitment[] {
  const text = userTranscript.trim();
  if (!text || !hasSoftFollowUpSignal(text)) return [];

  const createdAt = now();
  return [
    {
      id: idFactory(),
      kind: "follow_up",
      summary: text.slice(0, 160),
      sourceText: text,
      dueAt: inferDueAt(text, createdAt).toISOString(),
      status: "active",
      createdAt: createdAt.toISOString()
    }
  ];
}

// 判断文本是否像值得之后关心的事件, 不处理精确时间提醒.
function hasSoftFollowUpSignal(text: string) {
  return /\b(tomorrow|next week|interview|exam|meeting|deadline)\b/i.test(text)
    || /(明天|下周|面试|考试|会议|截止|ddl|deadline)/i.test(text);
}

// 根据文本中的模糊时间推断承诺触发时间.
function inferDueAt(text: string, baseTime: Date) {
  const dueAt = new Date(baseTime);
  if (/\bnext week\b|下周/i.test(text)) {
    dueAt.setDate(dueAt.getDate() + 7);
    return dueAt;
  }

  dueAt.setDate(dueAt.getDate() + 1);
  return dueAt;
}

// 修改承诺状态.
function updateCommitmentStatus(commitments: AikoCommitment[], commitmentId: string, status: AikoCommitmentStatus) {
  const commitment = commitments.find((candidate) => candidate.id === commitmentId);
  if (!commitment) return false;
  commitment.status = status;
  return true;
}

// 限制内存承诺数量.
function trimCommitments(commitments: AikoCommitment[], maxRecords: number) {
  while (commitments.length > maxRecords) {
    commitments.shift();
  }
}

// 克隆承诺快照.
function cloneCommitment(commitment: AikoCommitment): AikoCommitment {
  return { ...commitment };
}
