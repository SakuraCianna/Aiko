import type { AikoApi, SpeechStreamFinishResponseDto } from "../../shared/ipcTypes";
import { createWavAudioRecorder, type WavAudioRecorder } from "./microphoneRecorder";

export type Pcm16Frame = {
  pcmBase64: string;
  byteLength: number;
  sampleCount: number;
};

export type Pcm16FrameChunker = {
  append: (samples: Float32Array) => Pcm16Frame[];
  flush: () => Pcm16Frame[];
};

export type StreamingAsrController = {
  start: (stream: MediaStream) => Promise<{ ok: true; sessionId: string } | { ok: false; message: string }>;
  stop: () => Promise<SpeechStreamFinishResponseDto>;
  cancel: () => Promise<void>;
};

export type StreamingAsrControllerOptions = {
  api?: Pick<AikoApi, "startSpeechStream" | "pushSpeechStreamChunk" | "finishSpeechStream" | "cancelSpeechStream">;
  createRecorder?: (stream: MediaStream, options: { onPcmChunk?: (chunk: Float32Array) => void }) => Promise<WavAudioRecorder>;
  createSessionId?: () => string;
  sampleRate?: number;
  frameMs?: number;
  onTranscript?: (text: string, result: SpeechStreamFinishResponseDto) => void;
};

const DEFAULT_SAMPLE_RATE = 16000;
const DEFAULT_FRAME_MS = 200;

// 创建 PCM16 分包器, 默认按腾讯云实时 ASR 推荐的 16k/200ms/6400 bytes 切片.
export function createPcm16FrameChunker(options: { sampleRate?: number; frameMs?: number } = {}): Pcm16FrameChunker {
  const sampleRate = options.sampleRate ?? DEFAULT_SAMPLE_RATE;
  const frameMs = options.frameMs ?? DEFAULT_FRAME_MS;
  const frameSampleCount = Math.floor((sampleRate * frameMs) / 1000);
  let pending: Float32Array = new Float32Array(0);

  return {
    // 追加麦克风 Float32 PCM, 只在凑齐一个完整帧时输出.
    append(samples) {
      if (samples.length === 0) return [];
      pending = concatFloat32(pending, samples);
      const frames: Pcm16Frame[] = [];
      while (pending.length >= frameSampleCount) {
        const frameSamples = pending.slice(0, frameSampleCount);
        frames.push(encodePcm16Frame(frameSamples));
        pending = pending.slice(frameSampleCount);
      }
      return frames;
    },

    // 结束录音前输出最后不足一帧的尾包.
    flush() {
      if (pending.length === 0) return [];
      const frame = encodePcm16Frame(pending);
      pending = new Float32Array(0);
      return [frame];
    }
  };
}

// 创建 renderer 侧流式 ASR 控制器, 负责 start/chunk/finish 三段式 IPC.
export function createStreamingAsrController(options: StreamingAsrControllerOptions = {}): StreamingAsrController {
  const api = options.api ?? window.aiko;
  const createRecorder = options.createRecorder ?? createWavAudioRecorder;
  const createSessionId = options.createSessionId ?? (() => crypto.randomUUID());
  const sampleRate = options.sampleRate ?? DEFAULT_SAMPLE_RATE;
  const frameMs = options.frameMs ?? DEFAULT_FRAME_MS;
  const chunker = createPcm16FrameChunker({ sampleRate, frameMs });
  let sessionId = "";
  let sequence = 0;
  let recorder: WavAudioRecorder | null = null;
  let active = false;
  let pushQueue = Promise.resolve();

  return {
    // 向主进程声明新的 ASR 流, 成功后才开始创建 recorder.
    async start(stream) {
      sessionId = createSessionId();
      const startResult = await api.startSpeechStream({ sessionId, sampleRate, frameMs });
      if (!startResult.ok) return startResult;

      active = true;
      try {
        recorder = await createRecorder(stream, {
          onPcmChunk(chunk) {
            if (!active) return;
            enqueueFrames(chunker.append(chunk), false);
          }
        });
      } catch (error) {
        active = false;
        await api.cancelSpeechStream({ sessionId });
        throw error;
      }
      return { ok: true, sessionId };
    },

    // 停止录音, 刷出尾包, 等待主进程返回最终转写.
    async stop() {
      if (!active || !sessionId) return { ok: false, message: "Speech stream is not active" };
      active = false;
      const currentRecorder = recorder;
      recorder = null;
      if (currentRecorder) await currentRecorder.stop();
      enqueueFrames(chunker.flush(), true);
      const pushResult = await waitForPendingPushes();
      if (!pushResult.ok) return pushResult;
      const result = await api.finishSpeechStream({ sessionId });
      if (result.ok && result.transcript.trim().length > 0) {
        options.onTranscript?.(result.transcript, result);
      }
      return result;
    },

    // 取消录音并通知主进程释放会话.
    async cancel() {
      active = false;
      const currentRecorder = recorder;
      recorder = null;
      if (currentRecorder) await currentRecorder.stop();
      if (sessionId) {
        await api.cancelSpeechStream({ sessionId });
      }
    }
  };

  // 把一个或多个 PCM 包串行推送到主进程, 保证 sequence 单调递增.
  function enqueueFrames(frames: Pcm16Frame[], isFinal: boolean) {
    frames.forEach((frame, index) => {
      const request = {
        sessionId,
        sequence: sequence++,
        sampleRate,
        pcmBase64: frame.pcmBase64,
        isFinal: isFinal && index === frames.length - 1
      };
      pushQueue = pushQueue.then(async () => {
        const response = await api.pushSpeechStreamChunk(request);
        if (!response.ok) throw new Error(response.message || "Failed to push speech stream chunk");
      });
    });
  }

  // 等待所有分片发送完毕, 失败时取消主进程会话并返回受控错误.
  async function waitForPendingPushes(): Promise<{ ok: true } | { ok: false; message: string }> {
    try {
      await pushQueue;
      return { ok: true };
    } catch (error) {
      await api.cancelSpeechStream({ sessionId });
      return { ok: false, message: error instanceof Error ? error.message : "Failed to push speech stream chunk" };
    }
  }
}

// 拼接两个 Float32 PCM 数组, 用于保留尚未凑够一帧的样本.
function concatFloat32(left: Float32Array, right: Float32Array): Float32Array {
  if (left.length === 0) return new Float32Array(right);
  const result = new Float32Array(left.length + right.length);
  result.set(left, 0);
  result.set(right, left.length);
  return result;
}

// 把 Float32 PCM 转成 PCM16LE 并编码成 base64.
function encodePcm16Frame(samples: Float32Array): Pcm16Frame {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < samples.length; index += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[index] ?? 0));
    view.setInt16(index * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
  }
  return {
    pcmBase64: bytesToBase64(bytes),
    byteLength: bytes.byteLength,
    sampleCount: samples.length
  };
}

// 在浏览器和 Vitest Node 环境中都能把 Uint8Array 编码为 base64.
function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");

  let binary = "";
  const step = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += step) {
    const chunk = bytes.subarray(offset, offset + step);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}
