import { describe, expect, it } from "vitest";
import { createActionExecutor } from "../../src/main/actions/actionExecutor";
import type { PendingActionDto } from "../../src/shared/ipcTypes";

describe("createActionExecutor", () => {
  it("opens low-risk URLs through the injected capability", async () => {
    const opened: string[] = [];
    const executor = createActionExecutor({
      openUrl: async (url) => {
        opened.push(url);
      },
      openApplication: async () => false,
      now: () => new Date("2026-05-19T10:00:00.000Z")
    });

    const result = await executor.execute({
      action: lowRiskAction("open_url", "https://example.com"),
      remember: false
    });

    expect(result).toEqual({
      ok: true,
      message: "已打开网页."
    });
    expect(opened).toEqual(["https://example.com"]);
  });

  it("creates a relative reminder from action parameters", async () => {
    const executor = createActionExecutor({
      openUrl: async () => undefined,
      openApplication: async () => false,
      now: () => new Date("2026-05-19T10:00:00.000Z")
    });

    const result = await executor.execute({
      action: {
        ...lowRiskAction("create_reminder", "喝水"),
        params: { amount: 30, unit: "minutes", title: "喝水" }
      },
      remember: true
    });

    expect(result.ok).toBe(true);
    expect(result.message).toBe("已创建提醒:喝水.");
    expect(executor.listReminders()).toMatchObject([
      {
        title: "喝水",
        triggerAt: "2026-05-19T10:30:00.000Z",
        status: "active"
      }
    ]);
  });

  it("creates hour-based relative reminders", async () => {
    const executor = createActionExecutor({
      openUrl: async () => undefined,
      openApplication: async () => false,
      now: () => new Date("2026-05-19T10:00:00.000Z")
    });

    const result = await executor.execute({
      action: {
        ...lowRiskAction("create_reminder", "喝水"),
        params: { amount: 2, unit: "hours", title: "喝水" }
      },
      remember: false
    });

    expect(result).toEqual({
      ok: true,
      message: "已创建提醒:喝水."
    });
    expect(executor.listReminders()).toMatchObject([
      {
        title: "喝水",
        triggerAt: "2026-05-19T12:00:00.000Z",
        status: "active"
      }
    ]);
  });

  it("rejects high-risk actions", async () => {
    const executor = createActionExecutor({
      openUrl: async () => undefined,
      openApplication: async () => false,
      now: () => new Date("2026-05-19T10:00:00.000Z")
    });

    const result = await executor.execute({
      action: {
        ...lowRiskAction("shell_command", "Remove-Item"),
        risk: "high"
      },
      remember: false
    });

    expect(result).toEqual({
      ok: false,
      message: "这个操作风险太高,当前版本不会执行."
    });
  });

  it("uses injected repositories for remembered rules and reminders", async () => {
    const remembered: string[] = [];
    const savedReminders: string[] = [];
    const executor = createActionExecutor({
      openUrl: async () => undefined,
      openApplication: async () => true,
      now: () => new Date("2026-05-19T10:00:00.000Z"),
      permissionRepository: {
        remember: (rule) => remembered.push(`${rule.capability}:${rule.target.toLowerCase()}`),
        has: (rule) => rule.capability === "open_application" && rule.target.toLowerCase() === "chrome",
        list: () => [{ capability: "open_application", target: "chrome", risk: "low" }]
      },
      reminderRepository: {
        save: (reminder) => savedReminders.push(reminder.title),
        list: () => [
          {
            id: "reminder_saved",
            title: "喝水",
            triggerAt: "2026-05-19T10:30:00.000Z",
            status: "active"
          }
        ]
      }
    });

    await executor.execute({
      action: lowRiskAction("open_application", "Chrome"),
      remember: true
    });
    await executor.execute({
      action: {
        ...lowRiskAction("create_reminder", "喝水"),
        params: { amount: 30, unit: "minutes", title: "喝水" }
      },
      remember: false
    });

    expect(remembered).toEqual(["open_application:chrome"]);
    expect(savedReminders).toEqual(["喝水"]);
    expect(executor.isRememberedAction(lowRiskAction("open_application", "CHROME"))).toBe(true);
    expect(executor.listRememberedActions()).toEqual(["open_application:chrome"]);
    expect(executor.listReminders()).toMatchObject([{ title: "喝水" }]);
  });
});

function lowRiskAction(capability: string, target: string): PendingActionDto {
  return {
    title: target,
    source: "test",
    risk: "low",
    capability,
    target
  };
}
