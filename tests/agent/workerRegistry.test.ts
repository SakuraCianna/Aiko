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
  });

  it("rejects unknown workers", async () => {
    const registry = createAikoWorkerRegistry();

    await expect(registry.run("missing", {})).rejects.toThrow("Unknown Aiko worker: missing");
  });
});
