import { describe, expect, it } from "vitest";
import { createAikoPlanner } from "../../src/main/agent/planner/aikoPlanner";

describe("createAikoPlanner", () => {
  it("plans deterministic application actions without a model", async () => {
    const planner = createAikoPlanner();

    const plan = await planner.plan({
      userText: "打开 VS Code",
      userTranscript: "打开 VS Code",
      toolHints: []
    });

    expect(plan).toMatchObject({
      mode: "action",
      replyDraft: "我可以帮你打开 VS Code.",
      steps: [
        {
          kind: "action",
          source: "deterministic",
          action: {
            title: "打开应用:VS Code",
            source: "打开 VS Code",
            risk: "low",
            capability: "open_application",
            target: "VS Code"
          }
        }
      ]
    });
  });

  it("plans deterministic relative reminders", async () => {
    const planner = createAikoPlanner();

    const plan = await planner.plan({
      userText: "2 小时后提醒我喝水",
      userTranscript: "2 小时后提醒我喝水",
      toolHints: []
    });

    expect(plan.steps[0]?.action).toMatchObject({
      capability: "create_reminder",
      params: {
        amount: 2,
        unit: "hours",
        title: "喝水"
      }
    });
  });

  it("returns chat mode when no deterministic action is detected", async () => {
    const planner = createAikoPlanner();

    const plan = await planner.plan({
      userText: "帮我规划今晚的学习安排",
      userTranscript: "帮我规划今晚的学习安排",
      toolHints: []
    });

    expect(plan).toEqual({
      mode: "chat",
      replyDraft: "",
      steps: [],
      grounding: []
    });
  });
});
