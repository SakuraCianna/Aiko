import { describe, expect, it } from "vitest";
import { createPcm16WavBlob, createRecordedAudioName } from "../../src/renderer/audio/microphoneRecorder";
import { readFileSync } from "node:fs";

describe("microphoneRecorder", () => {
  it("uses a timestamped wav name for recorded microphone audio", () => {
    const name = createRecordedAudioName(new Date("2026-05-19T15:30:45.000Z"));

    expect(name).toBe("aiko-voice-2026-05-19-15-30-45.wav");
  });

  it("encodes PCM chunks as a WAV blob for Tencent Cloud ASR", () => {
    const blob = createPcm16WavBlob([new Float32Array([0, 0.5, -0.5])], 16000);

    expect(blob.type).toBe("audio/wav");
    expect(blob.size).toBeGreaterThan(44);
  });

  it("guards command input recording callbacks after unmount", () => {
    const commandInput = readFileSync("src/renderer/components/CommandInput.tsx", "utf8");

    expect(commandInput).toContain("mountedRef");
    expect(commandInput).toContain("recordingSessionRef");
    expect(commandInput).toContain("cleanupRecording");
  });

  it("uses microphone recording attachments so main-process Tencent Cloud ASR can transcribe audio", () => {
    const commandInput = readFileSync("src/renderer/components/CommandInput.tsx", "utf8");

    expect(commandInput).toContain("toggleVoiceInput");
    expect(commandInput).toContain("toggleAudioAttachmentRecording");
    expect(commandInput).toContain("createWavAudioRecorder");
    expect(commandInput).toContain("submitPayload(value, [...attachmentsRef.current, attachment])");
    expect(commandInput).not.toContain("createRealtimeSpeechController");
    expect(commandInput).not.toContain("MediaRecorder");
  });
});
