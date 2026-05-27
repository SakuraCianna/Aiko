import { describe, expect, it } from "vitest";
import { createActionExecutor } from "../../src/main/actions/actionExecutor";
import { createAikoActionJournal } from "../../src/main/agent/runtime/actionJournal";
import { createAikoRuntimeHooks } from "../../src/main/agent/runtime/runtimeHooks";
import type { PendingActionDto } from "../../src/shared/ipcTypes";

describe("createActionExecutor", () => {
  it("records local execution results in the action journal", async () => {
    const journal = createAikoActionJournal({ idFactory: () => "journal_execution" });
    const executor = createActionExecutor({
      actionJournal: journal,
      now: () => new Date("2026-05-24T10:00:00.000Z"),
      async openApplication() {
        return false;
      },
      async openUrl() {
        return;
      }
    });

    await executor.execute({
      remember: false,
      action: {
        id: "action_url",
        title: "Open URL",
        source: "test",
        risk: "low",
        capability: "open_url",
        target: "https://example.com"
      }
    });

    expect(journal.list()).toEqual([
      expect.objectContaining({
        phase: "execution",
        actionId: "action_url",
        capability: "open_url",
        ok: true
      })
    ]);
  });

  it("emits runtime hooks around local action execution", async () => {
    const hooks = createAikoRuntimeHooks();
    const events: string[] = [];
    hooks.on("before_tool_call", (event) => {
      events.push(`before:${(event.payload as { phase?: string }).phase}`);
    });
    hooks.on("after_tool_call", (event) => {
      events.push(`after:${(event.payload as { ok?: boolean }).ok}`);
    });
    const executor = createActionExecutor({
      hooks,
      now: () => new Date("2026-05-24T10:00:00.000Z"),
      async openApplication() {
        return false;
      },
      async openUrl() {
        return;
      }
    });

    await executor.execute({
      remember: false,
      action: {
        id: "action_url",
        title: "Open URL",
        source: "test",
        risk: "low",
        capability: "open_url",
        target: "https://example.com"
      }
    });

    expect(events).toEqual(["before:execute", "after:true"]);
  });

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
      message: "网页已打开. 这一步我接上了."
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
    expect(result.message).toBe("提醒已记好: 喝水. 到点我会把它拎出来.");
    expect(executor.listReminders()).toMatchObject([
      {
        title: "喝水",
        triggerAt: "2026-05-19T10:30:00.000Z",
        createdAt: "2026-05-19T10:00:00.000Z",
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
      message: "提醒已记好: 喝水. 到点我会把它拎出来."
    });
    expect(executor.listReminders()).toMatchObject([
      {
        title: "喝水",
        triggerAt: "2026-05-19T12:00:00.000Z",
        createdAt: "2026-05-19T10:00:00.000Z",
        status: "active"
      }
    ]);
  });

  it("cancels the latest active reminder through the local reminder store", async () => {
    const executor = createActionExecutor({
      openUrl: async () => undefined,
      openApplication: async () => false,
      now: () => new Date("2026-05-19T10:00:00.000Z")
    });

    await executor.execute({
      action: {
        ...lowRiskAction("create_reminder", "喝水"),
        params: { amount: 30, unit: "minutes", title: "喝水" }
      },
      remember: false
    });

    const result = await executor.execute({
      action: {
        ...lowRiskAction("cancel_reminder", "latest"),
        title: "取消最近提醒",
        params: { target: "latest" }
      },
      remember: false
    });

    expect(result).toEqual({
      ok: true,
      message: "已取消提醒: 喝水. 我把这条从待办里收起来了."
    });
    expect(executor.listReminders()).toMatchObject([
      {
        title: "喝水",
        status: "cancelled"
      }
    ]);
  });

  it("writes desktop markdown actions through the injected capability", async () => {
    const written: Array<{ title: string; content: string }> = [];
    const executor = createActionExecutor({
      openUrl: async () => undefined,
      openApplication: async () => false,
      writeDesktopMarkdown: async (request) => {
        written.push(request);
        return {
          filePath: "C:\\Users\\Sakura_Cianna\\Desktop\\Aiko\\20260523-163005-Aiko回答.md"
        };
      },
      now: () => new Date("2026-05-23T08:30:05.000Z")
    });

    const result = await executor.execute({
      action: {
        title: "写入 Aiko回答.md",
        source: "帮我生成一份具体学习规划",
        risk: "medium",
        capability: "write_desktop_markdown",
        target: "Desktop/Aiko",
        params: {
          title: "Aiko回答",
          content: "# 学习规划"
        }
      },
      remember: false
    });

    expect(written).toEqual([{ title: "Aiko回答", content: "# 学习规划" }]);
    expect(result).toEqual({
      ok: true,
      message: "我把 Markdown 写好了: C:\\Users\\Sakura_Cianna\\Desktop\\Aiko\\20260523-163005-Aiko回答.md"
    });
  });

  it("executes batch actions sequentially and creates an absolute reminder", async () => {
    const opened: Array<{ query: string; expectedPath?: string }> = [];
    const executor = createActionExecutor({
      openUrl: async () => undefined,
      openApplication: async (query, expectedPath) => {
        opened.push({ query, expectedPath });
        return true;
      },
      now: () => new Date("2026-05-24T09:00:00+08:00")
    });

    const result = await executor.execute({
      action: {
        title: "执行 3 个操作",
        source: "打开浏览器, 打开cursor, 然后帮我设定下午四点钟的闹钟",
        risk: "low",
        capability: "batch_actions",
        target: "batch",
        actions: [
          lowRiskAction("open_application", "Google Chrome"),
          lowRiskAction("open_application", "Cursor"),
          {
            ...lowRiskAction("create_reminder", "闹钟"),
            params: {
              title: "闹钟",
              triggerAt: "2026-05-24T08:00:00.000Z"
            }
          }
        ]
      },
      remember: false
    });

    expect(result.ok).toBe(true);
    expect(opened).toEqual([
      { query: "Google Chrome", expectedPath: undefined },
      { query: "Cursor", expectedPath: undefined }
    ]);
    expect(executor.listReminders()).toMatchObject([
      {
        title: "闹钟",
        triggerAt: "2026-05-24T08:00:00.000Z",
        status: "active"
      }
    ]);
    expect(result.message).toContain("这组操作我处理完了");
  });

  it("runs high-risk shell actions through the injected runner after approval", async () => {
    const executed: string[] = [];
    const executor = createActionExecutor({
      openUrl: async () => undefined,
      openApplication: async () => false,
      shellCommandRunner: async (request) => {
        executed.push(request.command);
        return { exitCode: 0, stdout: "ok", stderr: "", timedOut: false };
      },
      now: () => new Date("2026-05-19T10:00:00.000Z")
    });

    const result = await executor.execute({
      action: {
        title: "Run shell",
        source: "test",
        risk: "high",
        capability: "run_shell_command",
        target: "Get-ChildItem",
        params: { command: "Get-ChildItem -Name" }
      },
      remember: true
    });

    expect(result.ok).toBe(true);
    expect(result.message).toContain("ok");
    expect(executed).toEqual(["Get-ChildItem -Name"]);
    expect(executor.listRememberedActions()).toEqual([]);
  });

  it("rejects dangerous shell commands before invoking the runner", async () => {
    let invoked = false;
    const executor = createActionExecutor({
      openUrl: async () => undefined,
      openApplication: async () => false,
      shellCommandRunner: async () => {
        invoked = true;
        return { exitCode: 0, stdout: "", stderr: "", timedOut: false };
      },
      now: () => new Date("2026-05-19T10:00:00.000Z")
    });

    const result = await executor.execute({
      action: {
        title: "Run shell",
        source: "test",
        risk: "high",
        capability: "run_shell_command",
        target: "Remove-Item",
        params: { command: "Remove-Item -Recurse C:\\Temp" }
      },
      remember: false
    });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("blocked");
    expect(invoked).toBe(false);
  });

  it("executes high-risk file actions through the injected file system", async () => {
    const writes: Array<{ filePath: string; content: string; overwrite: boolean }> = [];
    const executor = createActionExecutor({
      openUrl: async () => undefined,
      openApplication: async () => false,
      fileSystem: {
        readTextFile: async () => "file-content",
        writeTextFile: async (filePath, content, options) => {
          writes.push({ filePath, content, overwrite: options.overwrite });
        },
        listDirectory: async () => [{ name: "note.md", path: "C:\\Aiko\\note.md", kind: "file" }],
        moveToTrash: async (filePath) => ({ originalPath: filePath, trashPath: "C:\\Aiko\\.trash\\note.md" })
      },
      now: () => new Date("2026-05-19T10:00:00.000Z")
    });

    const read = await executor.execute({
      action: { title: "Read file", source: "test", risk: "high", capability: "read_file", target: "C:\\Aiko\\note.md" },
      remember: true
    });
    const write = await executor.execute({
      action: {
        title: "Write file",
        source: "test",
        risk: "high",
        capability: "write_file",
        target: "C:\\Aiko\\note.md",
        params: { content: "new", overwrite: true }
      },
      remember: true
    });
    const list = await executor.execute({
      action: { title: "List directory", source: "test", risk: "medium", capability: "list_directory", target: "C:\\Aiko" },
      remember: false
    });
    const deleted = await executor.execute({
      action: { title: "Delete file", source: "test", risk: "high", capability: "delete_file", target: "C:\\Aiko\\note.md" },
      remember: true
    });

    expect(read.message).toContain("file-content");
    expect(write.ok).toBe(true);
    expect(list.message).toContain("note.md");
    expect(deleted.message).toContain(".trash");
    expect(writes).toEqual([{ filePath: "C:\\Aiko\\note.md", content: "new", overwrite: true }]);
    expect(executor.listRememberedActions()).toEqual([]);
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
            createdAt: "2026-05-19T10:00:00.000Z",
            status: "active"
          }
        ],
        cancelLatestActive: () => null
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

  it("binds remembered application permissions to the resolved application path", async () => {
    const opened: Array<{ query: string; expectedPath?: string }> = [];
    const remembered: string[] = [];
    const executor = createActionExecutor({
      openUrl: async () => undefined,
      openApplication: async (query, expectedPath) => {
        opened.push({ query, expectedPath });
        return true;
      },
      now: () => new Date("2026-05-19T10:00:00.000Z"),
      permissionRepository: {
        remember: (rule) => remembered.push(`${rule.capability}:${rule.target}`),
        has: (rule) => rule.target === "Google Chrome|C:\\Chrome\\chrome.exe",
        list: () => [{ capability: "open_application", target: "Google Chrome|C:\\Chrome\\chrome.exe", risk: "low" }]
      }
    });

    const action = {
      ...lowRiskAction("open_application", "Google Chrome"),
      params: { applicationPath: "C:\\Chrome\\chrome.exe" }
    };
    await executor.execute({ action, remember: true });

    expect(opened).toEqual([{ query: "Google Chrome", expectedPath: "C:\\Chrome\\chrome.exe" }]);
    expect(remembered).toEqual(["open_application:Google Chrome|C:\\Chrome\\chrome.exe"]);
    expect(executor.isRememberedAction(action)).toBe(true);
  });

  it("does not remember permissions when execution fails", async () => {
    const remembered: string[] = [];
    const executor = createActionExecutor({
      openUrl: async () => undefined,
      openApplication: async () => false,
      now: () => new Date("2026-05-19T10:00:00.000Z"),
      permissionRepository: {
        remember: (rule) => remembered.push(`${rule.capability}:${rule.target.toLowerCase()}`),
        has: () => false,
        list: () => []
      }
    });

    const result = await executor.execute({
      action: lowRiskAction("open_application", "Missing App"),
      remember: true
    });

    expect(result.ok).toBe(false);
    expect(remembered).toEqual([]);
  });

  it("returns a structured failure when an injected capability throws", async () => {
    const remembered: string[] = [];
    const executor = createActionExecutor({
      openUrl: async () => {
        throw new Error("system refused");
      },
      openApplication: async () => false,
      now: () => new Date("2026-05-19T10:00:00.000Z"),
      permissionRepository: {
        remember: (rule) => remembered.push(`${rule.capability}:${rule.target.toLowerCase()}`),
        has: () => false,
        list: () => []
      }
    });

    const result = await executor.execute({
      action: lowRiskAction("open_url", "https://example.com"),
      remember: true
    });

    expect(result).toEqual({
      ok: false,
      message: "这个动作执行时卡住了. 我先不假装完成, 你可以再试一次."
    });
    expect(remembered).toEqual([]);
  });

  it("sets a default app preference when a chosen app is remembered as default", async () => {
    const opened: string[] = [];
    const defaults: string[] = [];
    const executor = createActionExecutor({
      openUrl: async () => undefined,
      openApplication: async (query) => {
        opened.push(query);
        return true;
      },
      now: () => new Date("2026-05-19T10:00:00.000Z"),
      applicationPreferenceRepository: {
        setDefaultApplication: (defaultFor, target) => defaults.push(`${defaultFor}:${target}`),
        getDefaultApplication: () => null
      }
    });

    const result = await executor.execute({
      action: {
        ...lowRiskAction("open_application", "Google Chrome"),
        params: { defaultFor: "浏览器" }
      },
      remember: true
    });

    expect(opened).toEqual(["Google Chrome"]);
    expect(defaults).toEqual(["浏览器:Google Chrome"]);
    expect(result.message).toContain("默认浏览器");
    expect(result.message).toContain("将默认浏览器改成");
  });

  it("only stores durable permissions for explicitly auto-allowable actions", async () => {
    const remembered: string[] = [];
    const executor = createActionExecutor({
      openUrl: async () => undefined,
      openApplication: async () => false,
      writeDesktopMarkdown: async () => ({ filePath: "C:\\Users\\Sakura_Cianna\\Desktop\\Aiko\\a.md" }),
      now: () => new Date("2026-05-19T10:00:00.000Z"),
      permissionRepository: {
        remember: (rule) => remembered.push(`${rule.capability}:${rule.target.toLowerCase()}`),
        has: () => false,
        list: () => []
      }
    });

    await executor.execute({
      action: {
        title: "写入 Aiko回答.md",
        source: "长文",
        risk: "medium",
        capability: "write_desktop_markdown",
        target: "Desktop/Aiko",
        params: {
          title: "Aiko回答",
          content: "# 正文"
        }
      },
      remember: true
    });
    await executor.execute({
      action: {
        ...lowRiskAction("cancel_reminder", "latest"),
        title: "取消最近提醒",
        params: { target: "latest" }
      },
      remember: true
    });

    expect(remembered).toEqual([]);
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
