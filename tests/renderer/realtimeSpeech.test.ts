import { describe, expect, it } from "vitest";
import {
  collectSpeechRecognitionText,
  createRealtimeSpeechController,
  getRealtimeSpeechSupport,
  normalizeSpeechError
} from "../../src/renderer/audio/realtimeSpeech";

describe("realtimeSpeech", () => {
  it("reports unsupported when the Web Speech constructor is missing", () => {
    const support = getRealtimeSpeechSupport({});

    expect(support.supported).toBe(false);
    expect(support.reason).toContain("Web Speech API");
  });

  it("creates a zh-CN realtime recognizer with interim results enabled", () => {
    const created: unknown[] = [];
    class FakeRecognition {
      continuous = true;
      interimResults = false;
      lang = "";
      maxAlternatives = 0;
      onresult = null;
      onerror = null;
      onend = null;
      start() {}
      stop() {}
      abort() {}

      constructor() {
        created.push(this);
      }
    }

    const controller = createRealtimeSpeechController(
      {
        onInterimTranscript: () => {},
        onFinalTranscript: () => {},
        onError: () => {},
        onEnd: () => {}
      },
      { webkitSpeechRecognition: FakeRecognition }
    );

    expect(controller).not.toBeNull();
    expect(created[0]).toMatchObject({
      continuous: false,
      interimResults: true,
      lang: "zh-CN",
      maxAlternatives: 1
    });
  });

  it("collects final and interim text from recognition results", () => {
    const update = collectSpeechRecognitionText({
      resultIndex: 0,
      results: [
        { isFinal: false, 0: { transcript: "打开", confidence: 0.7 }, length: 1 },
        { isFinal: true, 0: { transcript: "浏览器", confidence: 0.9 }, length: 1 }
      ],
      length: 2
    });

    expect(update).toEqual({
      finalTranscript: "浏览器",
      interimTranscript: "打开"
    });
  });

  it("normalizes permission errors for microphone access", () => {
    expect(normalizeSpeechError("not-allowed")).toBe("无法访问麦克风, 请检查 Windows 麦克风权限.");
  });
});
