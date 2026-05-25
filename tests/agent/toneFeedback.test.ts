import { describe, expect, it } from "vitest";
import { analyzeUserTone } from "../../src/main/agent/experience/toneFeedback";

describe("analyzeUserTone", () => {
  it("detects corrective dissatisfaction from user tone", () => {
    const signal = analyzeUserTone("你这个回答太啰嗦了, 下次短一点");

    expect(signal).toMatchObject({
      tone: "corrective",
      satisfaction: "unsatisfied",
      aspect: "answer_style"
    });
    expect(signal.confidence).toBeGreaterThanOrEqual(0.8);
    expect(signal.recommendation).toContain("短");
  });

  it("detects satisfaction without treating it as a permanent command", () => {
    const signal = analyzeUserTone("现在可以了, 这个回复挺好");

    expect(signal).toMatchObject({
      tone: "positive",
      satisfaction: "satisfied",
      aspect: "general"
    });
    expect(signal.recommendation).toContain("保持");
  });

  it("keeps ordinary task requests neutral", () => {
    const signal = analyzeUserTone("帮我打开浏览器");

    expect(signal).toMatchObject({
      tone: "neutral",
      satisfaction: "unclear",
      aspect: "general",
      confidence: 0
    });
  });
});
