import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AikoAgentRuntime } from "../../src/main/agent/aikoAgentRuntime";
import { registerAikoHandlers } from "../../src/main/ipc/handlers";
import type { ChatResponse, PendingActionDto } from "../../src/shared/ipcTypes";

const electronMock = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const openPath = vi.fn(async () => "");

  return {
    handlers,
    openPath
  };
});

vi.mock("electron", () => ({
  BrowserWindow: vi.fn(),
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      electronMock.handlers.set(channel, handler);
    })
  },
  screen: {
    getCursorScreenPoint: vi.fn(() => ({ x: 100, y: 200 }))
  },
  shell: {
    openPath: electronMock.openPath
  }
}));

describe("registerAikoHandlers pending action approvals", () => {
  beforeEach(() => {
    electronMock.handlers.clear();
    electronMock.openPath.mockClear();
  });

  it("keeps the shared approval session alive when executing one application choice", async () => {
    const discardedThreadIds: string[] = [];
    let approvalActive = true;
    const runtime = createRuntime({
      response: createBrowserChoiceSourceAction(),
      resume(action) {
        return action.approval?.threadId === "approval-browser" && approvalActive
          ? { ok: true, message: "resumed" }
          : { ok: false, message: "expired" };
      },
      discard(action) {
        if (action.approval?.threadId) {
          approvalActive = false;
          discardedThreadIds.push(action.approval.threadId);
        }
      }
    });
    registerAikoHandlers({
      agentRuntime: runtime,
      petWindow: fakeWindow(),
      panelWindow: fakeWindow(),
      applicationProvider: () => browserApplications()
    });

    const chatResponse = await callHandler<ChatResponse>("chat:send-message", {
      text: "打开浏览器",
      attachments: []
    });
    const firstChoice = chatResponse.pendingAction?.choices?.[0]?.action;

    expect(firstChoice).toBeDefined();
    const executeResult = await callHandler<{ ok: boolean; message: string }>("action:execute", {
      action: firstChoice,
      remember: false
    });

    expect(executeResult.ok).toBe(true);
    expect(discardedThreadIds).toEqual([]);
    expect(electronMock.openPath).toHaveBeenCalledWith("C:\\Chrome\\chrome.exe");
  });

  it("exposes the agent debug snapshot over IPC", async () => {
    const runtime = createRuntime({
      response: createBrowserChoiceSourceAction(),
      resume() {
        return { ok: true, message: "resumed" };
      },
      discard() {
        return;
      }
    });
    registerAikoHandlers({
      agentRuntime: runtime,
      petWindow: fakeWindow(),
      panelWindow: fakeWindow(),
      applicationProvider: () => browserApplications()
    });

    await expect(callHandler("agent:debug-snapshot")).resolves.toMatchObject({
      runs: [],
      actionJournal: [],
      traces: [],
      workers: []
    });
  });
});

function createRuntime(options: {
  response: PendingActionDto;
  resume: (action: PendingActionDto) => { ok: boolean; message: string };
  discard: (action: PendingActionDto) => void;
}): AikoAgentRuntime {
  return {
    async respond() {
      return {
        message: "我找到了几个浏览器. 你选一个, 我再打开.",
        pendingAction: options.response
      };
    },
    async respondStream() {
      return {
        message: "unused"
      };
    },
    async resumePendingActionApproval(action) {
      return options.resume(action);
    },
    discardPendingActionApproval(action) {
      options.discard(action);
    },
    listConversation() {
      return { messages: [], maxMessages: 12, maxContextChars: 6000 };
    },
    resetConversation() {
      return { messages: [], maxMessages: 12, maxContextChars: 6000 };
    },
    listRuns() {
      return [];
    },
    listActionJournal() {
      return [];
    },
    listCommitments() {
      return [];
    },
    listWorkers() {
      return [];
    },
    listAgentDebugSnapshot() {
      return {
        runs: [],
        actionJournal: [],
        traces: [],
        workers: []
      };
    }
  };
}

function createBrowserChoiceSourceAction(): PendingActionDto {
  return {
    title: "打开应用:浏览器",
    source: "打开浏览器",
    risk: "low",
    capability: "open_application",
    target: "浏览器",
    approval: {
      mode: "interrupt",
      threadId: "approval-browser",
      status: "pending_action"
    }
  };
}

function browserApplications() {
  return [
    {
      name: "Google Chrome",
      aliases: ["Chrome", "chrome", "google chrome"],
      path: "C:\\Chrome\\chrome.exe"
    },
    {
      name: "Microsoft Edge",
      aliases: ["Edge", "edge", "microsoft edge"],
      path: "C:\\Edge\\msedge.exe"
    }
  ];
}

function fakeWindow() {
  return {
    setIgnoreMouseEvents: vi.fn(),
    getBounds: vi.fn(() => ({ x: 10, y: 20, width: 320, height: 480 })),
    show: vi.fn(),
    webContents: {
      send: vi.fn()
    }
  } as never;
}

async function callHandler<T>(channel: string, ...args: unknown[]): Promise<T> {
  const handler = electronMock.handlers.get(channel);
  if (!handler) throw new Error(`Missing IPC handler: ${channel}`);
  return await handler({}, ...args) as T;
}
