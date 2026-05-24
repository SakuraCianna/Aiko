import { describe, expect, it, vi } from "vitest";
import { createAikoMemoryAgent } from "../../src/main/agent/subagents/memoryAgent";
import type { MemoryCandidate, MemoryStatus } from "../../src/main/memory/memoryTypes";

describe("createAikoMemoryAgent", () => {
  it("recalls memories through the memory subagent boundary", async () => {
    const memoryAgent = createAikoMemoryAgent({
      memoryRuntime: {
        async recall(query, limit) {
          return [{ id: "m1", type: "preference", content: `${query}:${limit}` }];
        },
        async rememberCandidate() {
          return;
        }
      }
    });

    await expect(memoryAgent.recall("coffee", 3)).resolves.toEqual([
      { id: "m1", type: "preference", content: "coffee:3" }
    ]);
  });

  it("degrades recall failures to an empty memory list", async () => {
    const memoryAgent = createAikoMemoryAgent({
      memoryRuntime: {
        async recall() {
          throw new Error("sqlite busy");
        },
        async rememberCandidate() {
          return;
        }
      }
    });

    await expect(memoryAgent.recall("coffee")).resolves.toEqual([]);
  });

  it("deduplicates extracted candidates and persists the highest confidence candidate", async () => {
    const stored: Array<{ candidate: MemoryCandidate; status: MemoryStatus }> = [];
    const transcripts: string[] = [];
    const memoryAgent = createAikoMemoryAgent({
      memoryRuntime: {
        async recall() {
          return [];
        },
        async rememberCandidate(candidate, status) {
          stored.push({ candidate, status });
        }
      },
      async memoryCandidateExtractor(transcript) {
        transcripts.push(transcript);
        return [
          {
            type: "preference",
            content: "User likes quiet focus time. ",
            confidence: 0.72,
            requiresConfirmation: false
          },
          {
            type: "preference",
            content: "user likes quiet focus time.",
            confidence: 0.93,
            requiresConfirmation: false
          },
          {
            type: "permission",
            content: "Allow opening Cursor by default.",
            confidence: 0.9,
            requiresConfirmation: false
          }
        ];
      }
    });

    await memoryAgent.rememberExchange("I like quiet focus time.", "I will remember that.");

    expect(transcripts).toEqual(["用户:I like quiet focus time."]);
    expect(stored).toEqual([
      {
        candidate: {
          type: "preference",
          content: "user likes quiet focus time.",
          confidence: 0.93,
          requiresConfirmation: false
        },
        status: "accepted"
      },
      {
        candidate: {
          type: "permission",
          content: "Allow opening Cursor by default.",
          confidence: 0.9,
          requiresConfirmation: false
        },
        status: "pending_confirmation"
      }
    ]);
  });

  it("does not throw when extraction fails or the user text is empty", async () => {
    let calls = 0;
    const memoryAgent = createAikoMemoryAgent({
      memoryRuntime: {
        async recall() {
          return [];
        },
        async rememberCandidate() {
          calls += 1;
        }
      },
      async memoryCandidateExtractor() {
        throw new Error("bad json");
      }
    });

    await expect(memoryAgent.rememberExchange("hello", "reply")).resolves.toBeUndefined();
    await expect(memoryAgent.rememberExchange("   ", "reply")).resolves.toBeUndefined();
    expect(calls).toBe(0);
  });

  it("logs sanitized memory write failures for diagnosis", async () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const memoryAgent = createAikoMemoryAgent({
      memoryRuntime: {
        async recall() {
          return [];
        },
        async rememberCandidate() {
          throw new Error("should not persist");
        }
      },
      async memoryCandidateExtractor() {
        throw new Error("invalid json with Bearer secret-memory-token");
      }
    });

    try {
      await expect(memoryAgent.rememberExchange("call me Sakura", "got it")).resolves.toBeUndefined();

      expect(consoleWarn).toHaveBeenCalledTimes(1);
      const serialized = JSON.stringify(consoleWarn.mock.calls[0]);
      expect(serialized).toContain("[aiko:memory]");
      expect(serialized).toContain("invalid json");
      expect(serialized).not.toContain("secret-memory-token");
    } finally {
      consoleWarn.mockRestore();
    }
  });
});
