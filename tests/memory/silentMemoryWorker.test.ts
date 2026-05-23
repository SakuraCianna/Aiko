import { describe, expect, it } from "vitest";
import { MEMORY_EXTRACTION_PROMPT } from "../../src/main/ai/prompts";
import type { MemoryType } from "../../src/main/memory/memoryTypes";
import { recallMemories } from "../../src/main/memory/memoryRecall";
import { classifyMemoryCandidate, extractMemoryCandidates } from "../../src/main/memory/silentMemoryWorker";

describe("MEMORY_EXTRACTION_PROMPT", () => {
  it("lists the same memory types used by the code", () => {
    const types: MemoryType[] = [
      "preference",
      "relationship",
      "habit",
      "software",
      "recent_event",
      "reminder",
      "permission",
      "sensitive"
    ];

    for (const type of types) {
      expect(MEMORY_EXTRACTION_PROMPT).toContain(type);
    }
    expect(MEMORY_EXTRACTION_PROMPT).not.toContain("fact");
  });
});

describe("classifyMemoryCandidate", () => {
  it("silently accepts low-risk preference memory", () => {
    expect(
      classifyMemoryCandidate({
        type: "preference",
        content: "用户喜欢被称呼为 Sakura",
        confidence: 0.9,
        requiresConfirmation: false
      })
    ).toEqual("accepted");
  });

  it("requires confirmation for reminders", () => {
    expect(
      classifyMemoryCandidate({
        type: "reminder",
        content: "每天 21:00 提醒用户学习日语",
        confidence: 0.9,
        requiresConfirmation: true
      })
    ).toEqual("pending_confirmation");
  });
});

describe("extractMemoryCandidates", () => {
  it("filters invalid memory candidates instead of trusting malformed model output", async () => {
    const candidates = await extractMemoryCandidates("用户:以后叫我 Sakura", async () =>
      JSON.stringify([
        {
          type: "preference",
          content: "用户喜欢被称呼为 Sakura",
          confidence: 0.9,
          requiresConfirmation: false
        },
        {
          type: "fact",
          content: "不存在的类型不应该进入记忆库",
          confidence: 0.9,
          requiresConfirmation: false
        },
        {
          type: "software",
          content: "",
          confidence: 0.8,
          requiresConfirmation: false
        },
        {
          type: "habit",
          content: "用户晚上更容易学习",
          confidence: 2,
          requiresConfirmation: false
        }
      ])
    );

    expect(candidates).toEqual([
      {
        type: "preference",
        content: "用户喜欢被称呼为 Sakura",
        confidence: 0.9,
        requiresConfirmation: false
      }
    ]);
  });

  it("filters overlong memory candidates to reduce memory poisoning risk", async () => {
    const candidates = await extractMemoryCandidates("用户:记住一大段内容", async () =>
      JSON.stringify([
        {
          type: "preference",
          content: "x".repeat(1000),
          confidence: 0.9,
          requiresConfirmation: false
        }
      ])
    );

    expect(candidates).toEqual([]);
  });
});

describe("recallMemories", () => {
  it("recalls Chinese memories from natural queries without spaces", () => {
    expect(
      recallMemories(
        [
          {
            id: "memory_1",
            type: "preference",
            content: "用户喜欢晚上学习时先做轻量复习"
          }
        ],
        "帮我安排今晚学习"
      )
    ).toEqual([
      {
        id: "memory_1",
        type: "preference",
        content: "用户喜欢晚上学习时先做轻量复习"
      }
    ]);
  });
});
