import { describe, expect, it, vi } from "vitest";
import {
  createPcm16WavBlob,
  createRecordedAudioName,
  createWavAudioRecorder
} from "../../src/renderer/audio/microphoneRecorder";
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

  it("records microphone samples through AudioWorkletNode", async () => {
    const originalAudioContext = globalThis.AudioContext;
    const originalAudioWorkletNode = globalThis.AudioWorkletNode;
    const addModule = vi.fn(async () => undefined);
    const source = { connect: vi.fn(), disconnect: vi.fn() };
    const silentGain = { gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() };
    const close = vi.fn(async () => undefined);
    const createdNodes: FakeAudioWorkletNode[] = [];

    class FakeAudioContext {
      sampleRate = 16000;
      destination = {};
      audioWorklet = { addModule };

      constructor(readonly options: AudioContextOptions) {}

      createMediaStreamSource(stream: MediaStream) {
        expect(stream).toBe(fakeStream);
        return source;
      }

      createGain() {
        return silentGain;
      }

      close = close;
    }

    class FakeAudioWorkletNode {
      readonly port = {
        onmessage: null as ((event: MessageEvent<{ samples: Float32Array }>) => void) | null,
        close: vi.fn()
      };
      readonly connect = vi.fn();
      readonly disconnect = vi.fn();

      constructor(_context: AudioContext, readonly name: string, readonly options: AudioWorkletNodeOptions) {
        createdNodes.push(this);
      }

      emit(samples: number[]) {
        this.port.onmessage?.({
          data: {
            samples: new Float32Array(samples)
          }
        } as MessageEvent<{ samples: Float32Array }>);
      }
    }

    const fakeStream = {} as MediaStream;
    Object.defineProperty(globalThis, "AudioContext", { configurable: true, value: FakeAudioContext });
    Object.defineProperty(globalThis, "AudioWorkletNode", { configurable: true, value: FakeAudioWorkletNode });

    try {
      const livePcmChunks: Float32Array[] = [];
      const recorder = await createWavAudioRecorder(fakeStream, {
        onPcmChunk: (chunk) => livePcmChunks.push(chunk)
      });
      createdNodes[0]?.emit([0, 0.5, -0.5]);
      const blob = await recorder.stop();

      expect(addModule).toHaveBeenCalledTimes(1);
      expect(createdNodes[0]?.name).toBe("aiko-wav-recorder");
      expect(createdNodes[0]?.options).toMatchObject({ numberOfInputs: 1, numberOfOutputs: 1 });
      expect(source.connect).toHaveBeenCalledWith(createdNodes[0]);
      expect(createdNodes[0]?.connect).toHaveBeenCalledWith(silentGain);
      expect(livePcmChunks).toEqual([new Float32Array([0, 0.5, -0.5])]);
      expect(blob.type).toBe("audio/wav");
      expect(blob.size).toBeGreaterThan(44);
      expect(close).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(globalThis, "AudioContext", { configurable: true, value: originalAudioContext });
      Object.defineProperty(globalThis, "AudioWorkletNode", { configurable: true, value: originalAudioWorkletNode });
    }
  });

  it("guards command input recording callbacks after unmount", () => {
    const commandInput = readFileSync("src/renderer/components/CommandInput.tsx", "utf8");

    expect(commandInput).toContain("mountedRef");
    expect(commandInput).toContain("recordingSessionRef");
    expect(commandInput).toContain("cleanupRecording");
  });

  it("uses streaming microphone chunks before falling back to audio attachments", () => {
    const commandInput = readFileSync("src/renderer/components/CommandInput.tsx", "utf8");
    const microphoneRecorder = readFileSync("src/renderer/audio/microphoneRecorder.ts", "utf8");

    expect(commandInput).toContain("toggleVoiceInput");
    expect(commandInput).toContain("startStreamingVoiceInput");
    expect(commandInput).toContain("createWavAudioRecorder");
    expect(commandInput).toContain("createStreamingAsrController");
    expect(commandInput).toContain("submitVoiceTranscript");
    expect(microphoneRecorder).toContain("onPcmChunk");
    expect(microphoneRecorder).toContain("AudioWorkletNode");
    expect(microphoneRecorder).not.toContain("createScriptProcessor");
    expect(microphoneRecorder).not.toContain("ScriptProcessorNode");
    expect(commandInput).not.toContain("MediaRecorder");
  });
});
