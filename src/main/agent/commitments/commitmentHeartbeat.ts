import type { AikoCommitment, AikoCommitmentService } from "./commitmentService";

export type AikoCommitmentHeartbeatOptions = {
  commitmentService: Pick<AikoCommitmentService, "listDue" | "complete">;
  onDue: (commitment: AikoCommitment) => Promise<void> | void;
  now?: () => Date;
};

export type AikoCommitmentHeartbeat = ReturnType<typeof createAikoCommitmentHeartbeat>;

// 创建承诺心跳, 用于把软性 follow-up 从记忆转成一次主动关心.
export function createAikoCommitmentHeartbeat(options: AikoCommitmentHeartbeatOptions) {
  const now = options.now ?? (() => new Date());
  let ticking = false;

  return {
    // 扫描到期承诺并逐个交付, 同一时刻只允许一个 tick 在运行.
    async tick() {
      if (ticking) return;
      ticking = true;
      try {
        const dueCommitments = options.commitmentService.listDue(now());
        for (const commitment of dueCommitments) {
          await options.onDue(commitment);
          options.commitmentService.complete(commitment.id);
        }
      } finally {
        ticking = false;
      }
    }
  };
}
