import { describe, expect, it } from "vitest";
import { createAikoRunLifecycle } from "../../src/main/agent/runtime/runLifecycle";

describe("createAikoRunLifecycle", () => {
  it("records request state transitions with cloned snapshots", () => {
    const lifecycle = createAikoRunLifecycle({
      idFactory: () => "run_1",
      now: () => new Date("2026-05-24T10:00:00.000Z")
    });

    const run = lifecycle.createRun({ sessionId: "chat", userText: "open browser" });
    lifecycle.markRunning(run.id);
    lifecycle.markWaitingApproval(run.id, "waiting for browser approval");

    const [snapshot] = lifecycle.listRuns();
    expect(snapshot).toMatchObject({
      id: "run_1",
      sessionId: "chat",
      status: "waiting_approval",
      userText: "open browser",
      summary: "waiting for browser approval"
    });

    snapshot!.status = "failed";
    expect(lifecycle.listRuns()[0]?.status).toBe("waiting_approval");
  });

  it("serializes run work in submission order", async () => {
    const lifecycle = createAikoRunLifecycle({
      idFactory: (() => {
        let index = 0;
        return () => `run_${++index}`;
      })()
    });
    const order: string[] = [];
    const gate = createGate();

    const first = lifecycle.enqueue(async () => {
      order.push("first:start");
      await gate.promise;
      order.push("first:end");
      return "first";
    });
    const second = lifecycle.enqueue(async () => {
      order.push("second:start");
      return "second";
    });

    await Promise.resolve();
    expect(order).toEqual(["first:start"]);

    gate.release();
    await expect(first).resolves.toBe("first");
    await expect(second).resolves.toBe("second");
    expect(order).toEqual(["first:start", "first:end", "second:start"]);
  });
});

function createGate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
