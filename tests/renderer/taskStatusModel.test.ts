import { describe, expect, it } from "vitest";
import type { AikoAgentStatusEventDto } from "../../src/shared/ipcTypes";
import { reduceTaskCardFromAgentStatus } from "../../src/renderer/task/taskStatusModel";

describe("taskStatusModel", () => {
  it("turns agent lifecycle events into a user-visible task card", () => {
    const accepted = reduceTaskCardFromAgentStatus(null, status("accepted", "run_1"));
    const planning = reduceTaskCardFromAgentStatus(accepted, status("planning", "run_1"));
    const waiting = reduceTaskCardFromAgentStatus(planning, status("waiting_approval", "run_1"));

    expect(waiting?.status).toBe("waiting_approval");
    expect(waiting?.title).toBe("等待你确认");
    expect(waiting?.currentStep).toBe("准备安全动作");
    expect(waiting?.steps.map((step) => [step.id, step.status])).toContainEqual(["planning", "completed"]);
    expect(waiting?.steps.map((step) => [step.id, step.status])).toContainEqual(["action", "waiting"]);
  });

  it("keeps unrelated old run events from overwriting the active card", () => {
    const current = reduceTaskCardFromAgentStatus(null, status("running", "run_active"));
    const ignored = reduceTaskCardFromAgentStatus(current, status("failed", "run_old"));

    expect(ignored).toBe(current);
    expect(ignored?.status).toBe("running");
  });

  it("marks terminal states clearly", () => {
    const running = reduceTaskCardFromAgentStatus(null, status("running", "run_1"));
    const completed = reduceTaskCardFromAgentStatus(running, status("completed", "run_1"));

    expect(completed?.status).toBe("completed");
    expect(completed?.currentStep).toBe("完成收尾");
    expect(completed?.steps.at(-1)?.status).toBe("completed");
  });
});

function status(phase: AikoAgentStatusEventDto["phase"], runId: string): AikoAgentStatusEventDto {
  return {
    phase,
    runId,
    requestId: "request_1",
    message: `phase:${phase}`,
    createdAt: "2026-05-27T08:00:00.000Z"
  };
}
