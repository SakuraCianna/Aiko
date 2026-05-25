import { describe, expect, it } from "vitest";
import {
  createAikoExperiencePolicy,
  formatExperiencePolicyContext
} from "../../src/main/agent/experience/experiencePolicy";

describe("createAikoExperiencePolicy", () => {
  it("records inferred tone signals and turns them into short-term guidance", () => {
    const policy = createAikoExperiencePolicy({
      idFactory: () => "experience_1",
      now: () => new Date("2026-05-25T10:00:00.000Z")
    });

    const signal = policy.recordUserTone("你刚才说得太长了, 直接一点");
    const guidance = policy.createGuidance("继续帮我整理");
    const context = formatExperiencePolicyContext(guidance);

    expect(signal).toMatchObject({
      id: "experience_1",
      satisfaction: "unsatisfied",
      aspect: "answer_style"
    });
    expect(policy.listSignals()).toHaveLength(1);
    expect(context).toContain("体验策略");
    expect(context).toContain("不是用户明确指令");
    expect(context).toContain("短");
  });

  it("does not store neutral task requests as experience feedback", () => {
    const policy = createAikoExperiencePolicy();

    expect(policy.recordUserTone("打开 Cursor")).toBeNull();
    expect(policy.listSignals()).toEqual([]);
    expect(formatExperiencePolicyContext(policy.createGuidance("打开 Cursor"))).toBe("");
  });

  it("uses the current unsatisfied tone immediately even before it is stored", () => {
    const policy = createAikoExperiencePolicy();
    const guidance = policy.createGuidance("不是这个意思, 你理解错了");

    expect(guidance.currentSignal).toMatchObject({
      satisfaction: "unsatisfied",
      tone: "corrective"
    });
    expect(formatExperiencePolicyContext(guidance)).toContain("先承认具体问题");
  });
});
