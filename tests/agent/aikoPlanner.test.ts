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
      replyDraft: "嗯, VS Code 我可以帮你叫出来. 先等你点头确认, 我再动手.",
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

  it("understands natural Chinese app launch requests", async () => {
    const planner = createAikoPlanner();

    const plan = await planner.plan({
      userText: "帮我打开谷歌浏览器",
      userTranscript: "帮我打开谷歌浏览器",
      toolHints: []
    });

    expect(plan).toMatchObject({
      mode: "action",
      steps: [
        {
          action: {
            capability: "open_application",
            target: "Google Chrome"
          }
        }
      ]
    });
  });

  it("keeps generic browser requests ambiguous for local app selection", async () => {
    const planner = createAikoPlanner();

    const plan = await planner.plan({
      userText: "打开浏览器",
      userTranscript: "打开浏览器",
      toolHints: []
    });

    expect(plan.steps[0]?.action).toMatchObject({
      capability: "open_application",
      target: "浏览器"
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

  it("plans deterministic default app preference changes", async () => {
    const planner = createAikoPlanner();

    const plan = await planner.plan({
      userText: "将默认浏览器改成 Edge",
      userTranscript: "将默认浏览器改成 Edge",
      toolHints: []
    });

    expect(plan.steps[0]?.action).toMatchObject({
      capability: "set_default_application",
      target: "浏览器",
      params: {
        defaultFor: "浏览器",
        application: "Edge"
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
