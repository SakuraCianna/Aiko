import { describe, expect, it } from "vitest";
import { createAikoCommitmentService } from "../../src/main/agent/commitments/commitmentService";

describe("createAikoCommitmentService", () => {
  it("captures soft follow-up commitments from user context", () => {
    const service = createAikoCommitmentService({
      idFactory: () => "commitment_1",
      now: () => new Date("2026-05-24T10:00:00.000Z")
    });

    const captured = service.captureFromExchange("I have an interview tomorrow afternoon.", "I will keep that in mind.");

    expect(captured).toEqual([
      expect.objectContaining({
        id: "commitment_1",
        kind: "follow_up",
        status: "active",
        summary: "I have an interview tomorrow afternoon.",
        dueAt: "2026-05-25T10:00:00.000Z"
      })
    ]);
    expect(service.list()).toHaveLength(1);
  });

  it("returns and completes due commitments", () => {
    const service = createAikoCommitmentService({
      idFactory: () => "commitment_1",
      now: () => new Date("2026-05-24T10:00:00.000Z")
    });

    service.captureFromExchange("Remind me to check the plan tomorrow.", "Noted.");

    const due = service.listDue(new Date("2026-05-25T11:00:00.000Z"));
    expect(due).toHaveLength(1);

    service.complete(due[0]!.id);
    expect(service.listDue(new Date("2026-05-25T12:00:00.000Z"))).toEqual([]);
  });
});
