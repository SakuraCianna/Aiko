import { describe, expect, it } from "vitest";
import { createRecordedAudioName, selectSupportedAudioMimeType } from "../../src/renderer/audio/microphoneRecorder";
import { readFileSync } from "node:fs";

describe("microphoneRecorder", () => {
  it("selects the first MediaRecorder-supported audio MIME type", () => {
    const supported = selectSupportedAudioMimeType((mimeType) => mimeType === "audio/webm");

    expect(supported).toBe("audio/webm");
  });

  it("uses a timestamped webm name for recorded microphone audio", () => {
    const name = createRecordedAudioName(new Date("2026-05-19T15:30:45.000Z"));

    expect(name).toBe("aiko-voice-2026-05-19-15-30-45.webm");
  });

  it("guards command input recording callbacks after unmount", () => {
    const commandInput = readFileSync("src/renderer/components/CommandInput.tsx", "utf8");

    expect(commandInput).toContain("mountedRef");
    expect(commandInput).toContain("recordingSessionRef");
    expect(commandInput).toContain("cleanupRecording");
  });
});
