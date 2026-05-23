import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("ChatPanel", () => {
  it("shows current conversation context and can reset it", () => {
    const panel = readFileSync("src/renderer/components/ChatPanel.tsx", "utf8");
    const preload = readFileSync("src/main/preload.ts", "utf8");
    const sharedTypes = readFileSync("src/shared/ipcTypes.ts", "utf8");

    expect(panel).not.toContain("最近对话会显示在这里");
    expect(panel).toContain("window.aiko.listConversation");
    expect(panel).toContain("window.aiko.resetConversation");
    expect(panel).toContain("开启新对话");
    expect(preload).toContain("conversation:list");
    expect(preload).toContain("conversation:reset");
    expect(sharedTypes).toContain("ConversationSnapshotDto");
  });
});
