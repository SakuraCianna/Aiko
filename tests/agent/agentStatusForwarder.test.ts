import { describe, expect, it, vi } from "vitest";
import { createAikoRuntimeHooks } from "../../src/main/agent/runtime/runtimeHooks";
import { attachAikoAgentStatusForwarder } from "../../src/main/agent/runtime/agentStatus";

describe("attachAikoAgentStatusForwarder", () => {
  it("forwards agent status hook payloads to every live renderer window", async () => {
    const hooks = createAikoRuntimeHooks();
    const petWindow = fakeWindow();
    const panelWindow = fakeWindow();

    const stop = attachAikoAgentStatusForwarder([petWindow, panelWindow], hooks);
    await hooks.emit({
      name: "agent_status",
      runId: "run_1",
      payload: {
        phase: "retrieving",
        message: "Preparing context",
        requestId: "request_1",
        createdAt: "2026-05-25T10:00:00.000Z",
        detail: {
          memoryCount: 2
        }
      }
    });

    expect(petWindow.webContents.send).toHaveBeenCalledWith("agent:status", {
      phase: "retrieving",
      message: "Preparing context",
      requestId: "request_1",
      runId: "run_1",
      createdAt: "2026-05-25T10:00:00.000Z",
      detail: {
        memoryCount: 2
      }
    });
    expect(panelWindow.webContents.send).toHaveBeenCalledTimes(1);

    stop();
    await hooks.emit({
      name: "agent_status",
      runId: "run_2",
      payload: {
        phase: "planning",
        message: "Planning",
        createdAt: "2026-05-25T10:00:01.000Z"
      }
    });

    expect(petWindow.webContents.send).toHaveBeenCalledTimes(1);
  });

  it("turns tool hooks into action execution status events", async () => {
    const hooks = createAikoRuntimeHooks();
    const petWindow = fakeWindow();

    attachAikoAgentStatusForwarder([petWindow], hooks);
    await hooks.emit({
      name: "before_tool_call",
      runId: "run_tool",
      payload: {
        capability: "open_application",
        target: "Cursor",
        actionId: "action_1"
      }
    });

    expect(petWindow.webContents.send).toHaveBeenCalledWith(
      "agent:status",
      expect.objectContaining({
        phase: "action_executing",
        runId: "run_tool",
        detail: {
          capability: "open_application",
          target: "Cursor",
          actionId: "action_1"
        }
      })
    );
  });
});

function fakeWindow() {
  return {
    isDestroyed: vi.fn(() => false),
    webContents: {
      send: vi.fn()
    }
  };
}
