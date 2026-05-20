import { describe, expect, it } from "vitest";
import { createRecordedAudioName, selectSupportedAudioMimeType } from "../../src/renderer/audio/microphoneRecorder";

describe("microphoneRecorder", () => {
  it("selects the first MediaRecorder-supported audio MIME type", () => {
    const supported = selectSupportedAudioMimeType((mimeType) => mimeType === "audio/webm");

    expect(supported).toBe("audio/webm");
  });

  it("uses a timestamped webm name for recorded microphone audio", () => {
    const name = createRecordedAudioName(new Date("2026-05-19T15:30:45.000Z"));

    expect(name).toBe("aiko-voice-2026-05-19-15-30-45.webm");
  });
});
