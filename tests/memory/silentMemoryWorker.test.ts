import { describe, expect, it } from "vitest";
import { recallMemories } from "../../src/main/memory/memoryRecall";
import { classifyMemoryCandidate } from "../../src/main/memory/silentMemoryWorker";

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
