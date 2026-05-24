import { describe, expect, it } from "vitest";
import { createAikoActiveMemorySelector } from "../../src/main/agent/memory/activeMemory";

describe("createAikoActiveMemorySelector", () => {
  it("returns concise memory matches before the main model call", async () => {
    const selector = createAikoActiveMemorySelector({
      memoryAgent: {
        async recall(query, limit) {
          return [
            { id: "m1", type: "preference", content: `${query}:${limit}` },
            { id: "m2", type: "profile", content: "unused extra memory" }
          ];
        },
        async rememberExchange() {
          return;
        }
      },
      maxMemories: 1
    });

    await expect(selector.select("focus plan")).resolves.toEqual([
      { id: "m1", type: "preference", content: "focus plan:1" }
    ]);
  });

  it("falls back to no memories when recall times out", async () => {
    const selector = createAikoActiveMemorySelector({
      memoryAgent: {
        async recall() {
          await new Promise((resolve) => setTimeout(resolve, 30));
          return [{ id: "m1", type: "preference", content: "late memory" }];
        },
        async rememberExchange() {
          return;
        }
      },
      timeoutMs: 1
    });

    await expect(selector.select("anything")).resolves.toEqual([]);
  });
});
