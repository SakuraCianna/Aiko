import { describe, expect, it } from "vitest";
import {
  createCommitmentProactiveMessage,
  formatCommitmentFollowUp
} from "../../src/main/agent/commitments/proactiveCommitment";

describe("proactive commitment messages", () => {
  it("turns due commitments into renderer-safe proactive messages", () => {
    const message = createCommitmentProactiveMessage(
      {
        id: "commitment_interview",
        kind: "follow_up",
        summary: "I have an interview tomorrow afternoon.",
        sourceText: "I have an interview tomorrow afternoon.",
        dueAt: "2026-05-25T10:00:00.000Z",
        status: "active",
        createdAt: "2026-05-24T10:00:00.000Z"
      },
      new Date("2026-05-25T10:05:00.000Z")
    );

    expect(message).toEqual({
      id: "proactive_commitment_interview_2026-05-25T10:05:00.000Z",
      kind: "commitment",
      commitmentId: "commitment_interview",
      createdAt: "2026-05-25T10:05:00.000Z",
      message: formatCommitmentFollowUp("I have an interview tomorrow afternoon.")
    });
    expect(message.message).toContain("I have an interview tomorrow afternoon.");
  });
});
