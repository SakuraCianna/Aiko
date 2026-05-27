import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  createAikoSpeechController,
  createMouthShapeTimeline,
  normalizeSpeechText,
  splitSpeechSegments
} from "../../src/renderer/voice/speechOutput";

describe("speechOutput", () => {
  it("normalizes Markdown text before sending it to TTS", () => {
    expect(normalizeSpeechText("## 标题\n- **打开** `Chrome`\n[链接](https://example.com)")).toBe("标题 打开 Chrome 链接");
  });

  it("splits long replies into sentence-sized speech segments", () => {
    expect(splitSpeechSegments("第一句。第二句！第三句要继续说明, 但是不能一次塞给 TTS。")).toEqual([
      "第一句。",
      "第二句！",
      "第三句要继续说明, 但是不能一次塞给 TTS。"
    ]);
  });

  it("creates a phoneme-like mouth timeline from speech text", () => {
    const timeline = createMouthShapeTimeline("你好 Aiko");

    expect(timeline.length).toBeGreaterThan(4);
    expect(timeline.some((value) => value > 0.6)).toBe(true);
    expect(timeline.at(-1)).toBe(0);
  });

  it("queues cloud TTS segments and drives mouth sync while speaking", async () => {
    const synthesized: string[] = [];
    const mouthValues: number[] = [];
    const controller = createAikoSpeechController({
      synth: undefined,
      synthesizeSpeech: async ({ text }) => {
        synthesized.push(text);
        return { ok: true, dataUrl: `data:audio/wav;base64,${text}`, mimeType: "audio/wav" };
      },
      AudioCtor: FakeAudio as unknown as typeof Audio
    });

    const didStart = await controller.speak("第一句。第二句！", {
      onMouthOpen: (value) => mouthValues.push(value)
    });

    expect(didStart).toBe(true);
    expect(synthesized).toEqual(["第一句。", "第二句！"]);
    expect(mouthValues.some((value) => value > 0)).toBe(true);
    expect(mouthValues.at(-1)).toBe(0);
  });

  it("connects Aiko reply output to speech synthesis and VRM mouth sync", () => {
    const app = readFileSync("src/renderer/App.tsx", "utf8");
    const speechOutput = readFileSync("src/renderer/voice/speechOutput.ts", "utf8");
    const petStage = readFileSync("src/renderer/components/PetStage.tsx", "utf8");

    expect(app).toContain("createAikoSpeechController");
    expect(app).toContain("speakAiko(response.message");
    expect(app).toContain("setMouthOpen");
    expect(petStage).toContain("mouthOpen");
    expect(petStage).toContain("setMouthOpen");
    expect(speechOutput).toContain("synthesizeSpeech");
    expect(speechOutput).toContain("new AudioCtor");
    expect(speechOutput).toContain("SpeechSynthesisUtterance");
    expect(speechOutput).toContain("zh-CN");
  });
});

class FakeAudio {
  currentTime = 0;
  onplay: (() => void) | null = null;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(readonly src: string) {}

  async play() {
    this.onplay?.();
    this.onended?.();
  }

  pause() {}
}
