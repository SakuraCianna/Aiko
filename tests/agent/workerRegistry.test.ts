import { describe, expect, it } from "vitest";
import { createAikoWorkerRegistry } from "../../src/main/agent/workers/workerRegistry";

describe("createAikoWorkerRegistry", () => {
  it("registers and runs internal worker agents behind Aiko's single persona", async () => {
    const registry = createAikoWorkerRegistry();
    registry.register({
      name: "planning_writer",
      description: "Writes long plans.",
      async run(input) {
        return { worker: "planning_writer", input };
      }
    });

    expect(registry.list()).toEqual([
      {
        name: "planning_writer",
        description: "Writes long plans."
      }
    ]);
    await expect(registry.run("planning_writer", { topic: "agent" })).resolves.toEqual({
      worker: "planning_writer",
      input: { topic: "agent" }
    });
    expect(registry.listRuns()).toMatchObject([
      {
        workerName: "planning_writer",
        status: "completed",
        inputSummary: expect.stringContaining("agent"),
        outputSummary: expect.stringContaining("planning_writer")
      }
    ]);
  });

  it("rejects unknown workers", async () => {
    const registry = createAikoWorkerRegistry();

    await expect(registry.run("missing", {})).rejects.toThrow("Unknown Aiko worker: missing");
  });

  it("records failed worker runs for agent diagnostics", async () => {
    const registry = createAikoWorkerRegistry();
    registry.register({
      name: "broken_worker",
      description: "Fails intentionally.",
      async run() {
        throw new Error("boom");
      }
    });

    await expect(registry.run("broken_worker", {})).rejects.toThrow("boom");
    expect(registry.listRuns()).toMatchObject([
      {
        workerName: "broken_worker",
        status: "failed",
        error: "boom"
      }
    ]);
  });

  it("retries transient worker failures and records attempt count", async () => {
    const registry = createAikoWorkerRegistry();
    let attempts = 0;
    registry.register({
      name: "retry_worker",
      description: "Retries transient failures.",
      async run() {
        attempts += 1;
        if (attempts < 3) throw new Error(`temporary-${attempts}`);
        return { ok: true };
      }
    });

    await expect(registry.run("retry_worker", { retry: true }, { maxAttempts: 3 })).resolves.toEqual({ ok: true });
    expect(attempts).toBe(3);
    expect(registry.listRuns()).toMatchObject([
      {
        workerName: "retry_worker",
        status: "completed",
        attempts: 3,
        outputSummary: expect.stringContaining("true")
      }
    ]);
  });
});
