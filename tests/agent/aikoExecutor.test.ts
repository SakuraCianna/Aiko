import { describe, expect, it } from "vitest";
import { createAikoExecutor } from "../../src/main/agent/executor/aikoExecutor";
import type { AikoPlan } from "../../src/main/agent/types";

describe("createAikoExecutor", () => {
  it("extracts the first pending action from an action plan", async () => {
    const executor = createAikoExecutor();
    const plan: AikoPlan = {
      mode: "action",
      replyDraft: "嗯, VS Code 我可以帮你叫出来. 先等你点头确认, 我再动手.",
      grounding: [],
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
    };

    await expect(executor.prepare(plan)).resolves.toEqual({
      kind: "pending_action",
      message: "嗯, VS Code 我可以帮你叫出来. 先等你点头确认, 我再动手.",
      action: plan.steps[0]?.action
    });
  });

  it("wraps multiple action steps as a batch pending action", async () => {
    const executor = createAikoExecutor();
    const plan: AikoPlan = {
      mode: "action",
      replyDraft: "我拆成 3 个动作, 等你确认后按顺序执行.",
      grounding: [],
      steps: [
        {
          kind: "action",
          source: "deterministic",
          action: lowRiskAction("open_application", "浏览器")
        },
        {
          kind: "action",
          source: "deterministic",
          action: lowRiskAction("open_application", "Cursor")
        },
        {
          kind: "action",
          source: "deterministic",
          action: {
            ...lowRiskAction("create_reminder", "闹钟"),
            params: {
              title: "闹钟",
              triggerAt: "2026-05-24T08:00:00.000Z"
            }
          }
        }
      ]
    };

    await expect(executor.prepare(plan)).resolves.toMatchObject({
      kind: "pending_actions",
      message: "我拆成 3 个动作, 等你确认后按顺序执行.",
      actions: [
        { capability: "open_application", target: "浏览器" },
        { capability: "open_application", target: "Cursor" },
        { capability: "create_reminder", target: "闹钟" }
      ]
    });
  });

  it("blocks high risk actions before local execution", async () => {
    const executor = createAikoExecutor();
    const plan: AikoPlan = {
      mode: "action",
      replyDraft: "这个操作风险太高.",
      grounding: [],
      steps: [
        {
          kind: "action",
          source: "llm",
          action: {
            title: "执行命令",
            source: "执行命令",
            risk: "high",
            capability: "shell_command",
            target: "Remove-Item"
          }
        }
      ]
    };

    await expect(executor.prepare(plan)).resolves.toEqual({
      kind: "blocked",
      message: "这个动作风险偏高, 我先不碰. 稳一点比较好."
    });
  });
});

function lowRiskAction(capability: string, target: string) {
  return {
    title: `${capability}:${target}`,
    source: target,
    risk: "low" as const,
    capability,
    target
  };
}
