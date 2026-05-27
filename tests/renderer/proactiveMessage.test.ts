import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("renderer proactive message bridge", () => {
  it("exposes proactive runtime messages through the preload bridge", () => {
    const sharedTypes = readFileSync("src/shared/ipcTypes.ts", "utf8");
    const preload = readFileSync("src/main/preload.ts", "utf8");

    expect(sharedTypes).toContain("AikoProactiveMessage");
    expect(sharedTypes).toContain("onProactiveMessage");
    expect(preload).toContain("aiko:proactive-message");
    expect(preload).toContain("onProactiveMessage");
  });

  it("lets App display and speak proactive messages without requiring user input", () => {
    const app = readFileSync("src/renderer/App.tsx", "utf8");

    expect(app).toContain("window.aiko.onProactiveMessage");
    expect(app).toContain("handleProactiveMessage");
    expect(app).toContain("proactive.shouldSpeak");
    expect(app).toContain("speakAiko(proactive.message");
  });
});
