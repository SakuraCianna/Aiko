import { describe, expect, it } from "vitest";
import { createAikoCommitmentHeartbeat } from "../../src/main/agent/commitments/commitmentHeartbeat";
import { createAikoCommitmentService } from "../../src/main/agent/commitments/commitmentService";

describe("createAikoCommitmentHeartbeat", () => {
  it("delivers due commitments once and marks them completed", async () => {
    const delivered: string[] = [];
    const service = createAikoCommitmentService({
      idFactory: () => "commitment_1",
      now: () => new Date("2026-05-24T10:00:00.000Z")
    });
    service.captureFromExchange("I have an interview tomorrow.", "Noted.");
    const heartbeat = createAikoCommitmentHeartbeat({
      commitmentService: service,
      now: () => new Date("2026-05-25T10:05:00.000Z"),
      async onDue(commitment) {
        delivered.push(commitment.summary);
      }
    });

    await heartbeat.tick();
    await heartbeat.tick();

    expect(delivered).toEqual(["I have an interview tomorrow."]);
    expect(service.list()[0]?.status).toBe("completed");
  });
});
