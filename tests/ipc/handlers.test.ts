import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AikoAgentRuntime } from "../../src/main/agent/aikoAgentRuntime";
import { registerAikoHandlers } from "../../src/main/ipc/handlers";
import type { ChatResponse, PendingActionDto, SpeechTranscriptDelta } from "../../src/shared/ipcTypes";

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
      statuses: [],
      experienceSignals: [],
      actionJournal: [],
      traces: [],
      workers: []
    });
  });

  it("synthesizes speech through the injected voice provider", async () => {
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
      applicationProvider: () => browserApplications(),
      speechSynthesisProvider: {
        async synthesize(input) {
          return {
            ok: true,
            dataUrl: `data:audio/wav;base64,${Buffer.from(input.text).toString("base64")}`,
            mimeType: "audio/wav"
          };
        }
      }
    });

    await expect(callHandler("voice:synthesize", { text: "你好", emotion: "happy" })).resolves.toEqual({
      ok: true,
      dataUrl: "data:audio/wav;base64,5L2g5aW9",
      mimeType: "audio/wav"
    });
  });

  it("exposes voice provider status over IPC", async () => {
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
      applicationProvider: () => browserApplications(),
      voiceHealthService: {
        async snapshot() {
          return {
            asr: {
              provider: "tencent-cloud",
              status: "ready",
              baseUrl: "https://asr.tencentcloudapi.com",
              message: "ready"
            },
            tts: {
              provider: "tencent-cloud",
              status: "disabled",
              baseUrl: "https://tts.tencentcloudapi.com",
              message: "disabled"
            }
          };
        }
      }
    });

    await expect(callHandler("voice:status")).resolves.toMatchObject({
      asr: { provider: "tencent-cloud", status: "ready" },
      tts: { provider: "tencent-cloud", status: "disabled" }
    });
  });

  it("streams microphone PCM chunks through IPC and emits the final transcript", async () => {
    const sender = fakeSender();
    const pushedSequences: number[] = [];
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
      applicationProvider: () => browserApplications(),
      speechStreamingProvider: {
        async start(input) {
          expect(input).toEqual({ sessionId: "speech-1", sampleRate: 16000, frameMs: 200 });
        },
        async pushChunk(input) {
          pushedSequences.push(input.sequence);
          expect(input.sessionId).toBe("speech-1");
          expect(input.sampleRate).toBe(16000);
          expect(input.pcm.byteLength).toBe(2);
        },
        async finish(input) {
          expect(input).toEqual({ sessionId: "speech-1" });
          return { transcript: "你好 Aiko", confidence: 0.9, language: "zh" };
        },
        async cancel() {
          return;
        }
      }
    });

    await expect(callHandlerWithEvent("voice:stream-start", { sender }, {
      sessionId: "speech-1",
      sampleRate: 16000,
      frameMs: 200
    })).resolves.toEqual({ ok: true, sessionId: "speech-1" });
    await expect(callHandlerWithEvent("voice:stream-chunk", { sender }, {
      sessionId: "speech-1",
      sequence: 0,
      sampleRate: 16000,
      pcmBase64: Buffer.from([0x00, 0x00]).toString("base64"),
      isFinal: false
    })).resolves.toEqual({ ok: true });
    await expect(callHandlerWithEvent("voice:stream-finish", { sender }, {
      sessionId: "speech-1"
    })).resolves.toEqual({ ok: true, transcript: "你好 Aiko", confidence: 0.9, language: "zh" });

    expect(pushedSequences).toEqual([0]);
    expect(sender.send).toHaveBeenCalledWith("voice:transcript-delta", {
      sessionId: "speech-1",
      sequence: 0,
      text: "你好 Aiko",
      isFinal: true,
      confidence: 0.9,
      language: "zh"
    } satisfies SpeechTranscriptDelta);
  });

  it("reports streaming ASR as unavailable when no provider is configured", async () => {
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

    await expect(callHandler("voice:stream-start", {
      sessionId: "speech-1",
      sampleRate: 16000,
      frameMs: 200
    })).resolves.toEqual({ ok: false, message: "ASR streaming provider is not configured" });
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
        statuses: [],
        experienceSignals: [],
        actionJournal: [],
        traces: [],
        workers: [],
        workerRuns: []
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

function fakeSender() {
  return {
    isDestroyed: vi.fn(() => false),
    send: vi.fn()
  };
}

async function callHandler<T>(channel: string, ...args: unknown[]): Promise<T> {
  const handler = electronMock.handlers.get(channel);
  if (!handler) throw new Error(`Missing IPC handler: ${channel}`);
  return await handler({}, ...args) as T;
}

async function callHandlerWithEvent<T>(channel: string, event: unknown, ...args: unknown[]): Promise<T> {
  const handler = electronMock.handlers.get(channel);
  if (!handler) throw new Error(`Missing IPC handler: ${channel}`);
  return await handler(event, ...args) as T;
}
