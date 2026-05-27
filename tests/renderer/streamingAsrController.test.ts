import { describe, expect, it, vi } from "vitest";
import {
  createPcm16FrameChunker,
  createStreamingAsrController
} from "../../src/renderer/audio/streamingAsrController";
import type { WavAudioRecorder } from "../../src/renderer/audio/microphoneRecorder";
import type { AikoApi } from "../../src/shared/ipcTypes";

describe("streamingAsrController", () => {
  it("frames live microphone PCM into 200ms 16k PCM packets", () => {
    const chunker = createPcm16FrameChunker({ sampleRate: 16000, frameMs: 200 });

    expect(chunker.append(new Float32Array(1600).fill(0))).toEqual([]);
    const frames = chunker.append(new Float32Array(1600).fill(0.5));

    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({ byteLength: 6400, sampleCount: 3200 });
    expect(Buffer.from(frames[0]?.pcmBase64 ?? "", "base64").byteLength).toBe(6400);
    expect(chunker.flush()).toEqual([]);
  });

  it("flushes the final partial packet before finishing the ASR stream", () => {
    const chunker = createPcm16FrameChunker({ sampleRate: 16000, frameMs: 200 });

    const frames = chunker.append(new Float32Array(1000).fill(-0.5));
    const finalFrames = chunker.flush();

    expect(frames).toEqual([]);
    expect(finalFrames).toHaveLength(1);
    expect(finalFrames[0]).toMatchObject({ byteLength: 2000, sampleCount: 1000 });
  });

  it("starts, pushes PCM frames, and finishes through the preload ASR API", async () => {
    const fakeRecorder = new FakeRecorder();
    const createRecorder = vi.fn(async (_stream: MediaStream, options: { onPcmChunk?: (chunk: Float32Array) => void }) => {
      fakeRecorder.onPcmChunk = options.onPcmChunk;
      return fakeRecorder;
    });
    const api = createFakeAikoApi({
      finishResult: { ok: true, transcript: "打开浏览器", confidence: 0.91, language: "zh" }
    });
    const transcripts: string[] = [];
    const controller = createStreamingAsrController({
      api,
      createRecorder,
      createSessionId: () => "speech-1",
      onTranscript: (text) => transcripts.push(text)
    });

    const startResult = await controller.start({} as MediaStream);
    fakeRecorder.emit(new Float32Array(3200).fill(0.25));
    const finishResult = await controller.stop();

    expect(startResult).toEqual({ ok: true, sessionId: "speech-1" });
    expect(api.startSpeechStream).toHaveBeenCalledWith({ sessionId: "speech-1", sampleRate: 16000, frameMs: 200 });
    expect(api.pushSpeechStreamChunk).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: "speech-1",
      sequence: 0,
      sampleRate: 16000,
      isFinal: false
    }));
    expect(api.finishSpeechStream).toHaveBeenCalledWith({ sessionId: "speech-1" });
    expect(fakeRecorder.stopped).toBe(true);
    expect(finishResult).toMatchObject({ ok: true, transcript: "打开浏览器" });
    expect(transcripts).toEqual(["打开浏览器"]);
  });

  it("cancels the main-process session when recorder startup fails", async () => {
    const api = createFakeAikoApi({
      finishResult: { ok: true, transcript: "unused" }
    });
    const controller = createStreamingAsrController({
      api,
      createRecorder: vi.fn(async () => {
        throw new Error("recorder failed");
      }),
      createSessionId: () => "speech-failed"
    });

    await expect(controller.start({} as MediaStream)).rejects.toThrow("recorder failed");
    expect(api.cancelSpeechStream).toHaveBeenCalledWith({ sessionId: "speech-failed" });
  });

  it("returns a controlled failure and cancels the ASR session when chunk push fails", async () => {
    const fakeRecorder = new FakeRecorder();
    const api = createFakeAikoApi({
      finishResult: { ok: true, transcript: "unused" }
    });
    vi.mocked(api.pushSpeechStreamChunk).mockResolvedValueOnce({ ok: false, message: "network down" });
    const controller = createStreamingAsrController({
      api,
      createRecorder: vi.fn(async (_stream, options) => {
        fakeRecorder.onPcmChunk = options.onPcmChunk;
        return fakeRecorder;
      }),
      createSessionId: () => "speech-push-failed"
    });

    await controller.start({} as MediaStream);
    fakeRecorder.emit(new Float32Array(3200).fill(0.25));

    await expect(controller.stop()).resolves.toEqual({ ok: false, message: "network down" });
    expect(api.cancelSpeechStream).toHaveBeenCalledWith({ sessionId: "speech-push-failed" });
  });
});

class FakeRecorder implements WavAudioRecorder {
  onPcmChunk?: (chunk: Float32Array) => void;
  stopped = false;

  emit(chunk: Float32Array) {
    this.onPcmChunk?.(chunk);
  }

  async stop() {
    this.stopped = true;
    return new Blob([], { type: "audio/wav" });
  }
}

function createFakeAikoApi(options: { finishResult: Awaited<ReturnType<AikoApi["finishSpeechStream"]>> }): AikoApi {
  return {
    ping: vi.fn(),
    setClickThrough: vi.fn(),
    getCursorState: vi.fn(),
    openPanel: vi.fn(),
    sendMessage: vi.fn(),
    streamMessage: vi.fn(),
    cancelStream: vi.fn(),
    synthesizeSpeech: vi.fn(),
    getVoiceStatus: vi.fn(),
    startSpeechStream: vi.fn(async () => ({ ok: true, sessionId: "speech-1" })),
    pushSpeechStreamChunk: vi.fn(async () => ({ ok: true })),
    finishSpeechStream: vi.fn(async () => options.finishResult),
    cancelSpeechStream: vi.fn(async () => ({ ok: true })),
    onChatStreamDelta: vi.fn(),
    onSpeechTranscriptDelta: vi.fn(),
    onAgentStatus: vi.fn(),
    onProactiveMessage: vi.fn(),
    executeAction: vi.fn(),
    cancelAction: vi.fn(),
    listConversation: vi.fn(),
    resetConversation: vi.fn(),
    getAgentDebugSnapshot: vi.fn(),
    listMemory: vi.fn(),
    acceptMemoryCandidate: vi.fn(),
    rejectMemoryCandidate: vi.fn(),
    listReminders: vi.fn(),
    updateReminderStatus: vi.fn(),
    deleteReminder: vi.fn()
  } as unknown as AikoApi;
}
