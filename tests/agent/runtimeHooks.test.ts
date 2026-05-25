import { describe, expect, it } from "vitest";
import { createAikoRuntimeHooks } from "../../src/main/agent/runtime/runtimeHooks";

describe("createAikoRuntimeHooks", () => {
  it("emits hook events in registration order and isolates listener failures", async () => {
    const hooks = createAikoRuntimeHooks();
    const events: string[] = [];

    hooks.on("before_model_call", async (event) => {
      events.push(`${event.name}:${event.runId}`);
    });
    hooks.on("before_model_call", async () => {
      throw new Error("listener failed");
    });
    hooks.on("before_model_call", async () => {
      events.push("after-failure");
    });

    await hooks.emit({ name: "before_model_call", runId: "run_1", payload: { input: "hello" } });

    expect(events).toEqual(["before_model_call:run_1", "after-failure"]);
  });

  it("supports agent status events for renderer motion feedback", async () => {
    const hooks = createAikoRuntimeHooks();
    const events: unknown[] = [];

    hooks.on("agent_status", (event) => {
      events.push(event.payload);
    });

    await hooks.emit({
      name: "agent_status",
      runId: "run_status",
      payload: {
        phase: "retrieving",
        message: "Preparing context",
        requestId: "request_1",
        createdAt: "2026-05-25T10:00:00.000Z"
      }
    });

    expect(events).toEqual([
      {
        phase: "retrieving",
        message: "Preparing context",
        requestId: "request_1",
        createdAt: "2026-05-25T10:00:00.000Z"
      }
    ]);
  });
});
