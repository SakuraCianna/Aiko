import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { normalizeSpeechText } from "../../src/renderer/voice/speechOutput";

describe("speechOutput", () => {
  it("normalizes Markdown text before sending it to TTS", () => {
    expect(normalizeSpeechText("## 标题\n- **打开** `Chrome`\n[链接](https://example.com)")).toBe("标题 打开 Chrome 链接");
  });

  it("connects Aiko reply output to speech synthesis", () => {
    const app = readFileSync("src/renderer/App.tsx", "utf8");
    const speechOutput = readFileSync("src/renderer/voice/speechOutput.ts", "utf8");

    expect(app).toContain("createAikoSpeechController");
    expect(app).toContain("speakAiko(response.message");
    expect(speechOutput).toContain("SpeechSynthesisUtterance");
    expect(speechOutput).toContain("zh-CN");
  });
});
