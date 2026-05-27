import { describe, expect, it } from "vitest";
import { createAikoPlanner } from "../../src/main/agent/planner/aikoPlanner";

describe("createAikoPlanner", () => {
  it("splits a compound local request into multiple deterministic actions", async () => {
    const planner = createAikoPlanner({
      now: () => new Date("2026-05-24T09:00:00+08:00")
    });

    const plan = await planner.plan({
      userText: "打开浏览器, 打开cursor, 然后帮我设定下午四点钟的闹钟",
      userTranscript: "打开浏览器, 打开cursor, 然后帮我设定下午四点钟的闹钟",
      toolHints: []
    });

    expect(plan.mode).toBe("action");
    expect(plan.steps.map((step) => step.action.capability)).toEqual([
      "open_application",
      "open_application",
      "create_reminder"
    ]);
    expect(plan.steps.map((step) => step.action.target)).toEqual(["浏览器", "Cursor", "闹钟"]);
    expect(plan.steps[2]?.action.params).toMatchObject({
      title: "闹钟",
      triggerAt: "2026-05-24T08:00:00.000Z"
    });
  });

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

  it("plans cancellation of the latest active reminder", async () => {
    const planner = createAikoPlanner();

    const plan = await planner.plan({
      userText: "取消刚才那个提醒",
      userTranscript: "取消刚才那个提醒",
      toolHints: []
    });

    expect(plan.steps[0]?.action).toMatchObject({
      title: "取消最近提醒",
      capability: "cancel_reminder",
      target: "latest",
      params: {
        target: "latest"
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

  it("plans explicit directory listing requests as medium-risk confirmed actions", async () => {
    const planner = createAikoPlanner();

    const plan = await planner.plan({
      userText: "帮我列出 E:\\CodeHome\\Aiko 目录",
      userTranscript: "帮我列出 E:\\CodeHome\\Aiko 目录",
      toolHints: []
    });

    expect(plan.steps[0]?.action).toMatchObject({
      title: "列出目录:E:\\CodeHome\\Aiko",
      capability: "list_directory",
      risk: "medium",
      target: "E:\\CodeHome\\Aiko"
    });
  });

  it("plans explicit local file reads as high-risk confirmed actions", async () => {
    const planner = createAikoPlanner();

    const plan = await planner.plan({
      userText: "读取 E:\\CodeHome\\Aiko\\README.md",
      userTranscript: "读取 E:\\CodeHome\\Aiko\\README.md",
      toolHints: []
    });

    expect(plan.steps[0]?.action).toMatchObject({
      title: "读取文件:E:\\CodeHome\\Aiko\\README.md",
      capability: "read_file",
      risk: "high",
      target: "E:\\CodeHome\\Aiko\\README.md"
    });
  });

  it("plans explicit PowerShell command requests as high-risk confirmed actions", async () => {
    const planner = createAikoPlanner();

    const plan = await planner.plan({
      userText: "运行 PowerShell 命令 Get-ChildItem -Name",
      userTranscript: "运行 PowerShell 命令 Get-ChildItem -Name",
      toolHints: []
    });

    expect(plan.steps[0]?.action).toMatchObject({
      title: "执行 Shell:Get-ChildItem -Name",
      capability: "run_shell_command",
      risk: "high",
      target: "Get-ChildItem -Name",
      params: {
        command: "Get-ChildItem -Name"
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
