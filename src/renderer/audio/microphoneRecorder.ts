import type { ChatAttachment } from "../../shared/chatPayload";

export type WavAudioRecorder = {
  stop: () => Promise<Blob>;
};

export type WavAudioRecorderOptions = {
  onPcmChunk?: (chunk: Float32Array) => void;
};

const RECORDER_WORKLET_NAME = "aiko-wav-recorder";
const RECORDER_SAMPLE_RATE = 16000;

const RECORDER_WORKLET_SOURCE = `
class AikoWavRecorderProcessor extends AudioWorkletProcessor {
  process(inputs, outputs) {
    const input = inputs[0]?.[0];
    const output = outputs[0]?.[0];
    if (output) output.fill(0);
    if (input && input.length > 0) {
      const samples = new Float32Array(input);
      this.port.postMessage({ samples }, [samples.buffer]);
    }
    return true;
  }
}

registerProcessor("${RECORDER_WORKLET_NAME}", AikoWavRecorderProcessor);
`;

// 创建浏览器内 WAV 录音器, 使用 AudioWorklet 采集 PCM 以降低录音延迟和弃用警告.
export async function createWavAudioRecorder(stream: MediaStream, options: WavAudioRecorderOptions = {}): Promise<WavAudioRecorder> {
  const AudioContextCtor = readAudioContextConstructor();
  const AudioWorkletNodeCtor = readAudioWorkletNodeConstructor();
  const audioContext = new AudioContextCtor({ sampleRate: RECORDER_SAMPLE_RATE });
  const source = audioContext.createMediaStreamSource(stream);
  const silentGain = audioContext.createGain();
  const chunks: Float32Array[] = [];
  let recorderNode: AudioWorkletNode | null = null;
  let stopped = false;

  try {
    await registerRecorderWorklet(audioContext);
    recorderNode = new AudioWorkletNodeCtor(audioContext, RECORDER_WORKLET_NAME, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1]
    });

    silentGain.gain.value = 0;
    recorderNode.port.onmessage = (event: MessageEvent<{ samples?: Float32Array }>) => {
      if (stopped) return;
      const samples = event.data.samples;
      if (samples instanceof Float32Array && samples.length > 0) {
        const chunk = new Float32Array(samples);
        chunks.push(chunk);
        options.onPcmChunk?.(chunk);
      }
    };

    source.connect(recorderNode);
    recorderNode.connect(silentGain);
    silentGain.connect(audioContext.destination);
  } catch (error) {
    disconnectAudioNodeQuietly(source);
    disconnectAudioNodeQuietly(silentGain);
    await closeAudioContextQuietly(audioContext);
    throw error;
  }

  return {
    // 停止录音并把 PCM 样本封装为 WAV Blob.
    async stop() {
      if (stopped) return createPcm16WavBlob(chunks, audioContext.sampleRate);
      stopped = true;
      disconnectAudioNodeQuietly(source);
      if (recorderNode) disconnectAudioNodeQuietly(recorderNode);
      recorderNode?.port.close();
      disconnectAudioNodeQuietly(silentGain);
      await audioContext.close();
      return createPcm16WavBlob(chunks, audioContext.sampleRate);
    }
  };
}

// 根据当前时间生成稳定的录音文件名.
export function createRecordedAudioName(now = new Date()): string {
  return `aiko-voice-${now.toISOString().slice(0, 19).replace("T", "-").replaceAll(":", "-")}.wav`;
}

// 把录音 Blob 转换成聊天附件.
export async function createAudioAttachmentFromBlob(blob: Blob, now = new Date()): Promise<ChatAttachment> {
  return {
    id: crypto.randomUUID(),
    kind: "audio",
    name: createRecordedAudioName(now),
    mimeType: blob.type || "audio/wav",
    size: blob.size,
    dataUrl: await blobToDataUrl(blob)
  };
}

// 把 Float32 PCM 分片封装为 16-bit PCM WAV.
export function createPcm16WavBlob(chunks: Float32Array[], sampleRate: number): Blob {
  const sampleCount = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const buffer = new ArrayBuffer(44 + sampleCount * 2);
  const view = new DataView(buffer);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + sampleCount * 2, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, sampleCount * 2, true);

  let offset = 44;
  for (const chunk of chunks) {
    for (const sample of chunk) {
      const clamped = Math.max(-1, Math.min(1, sample));
      view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
      offset += 2;
    }
  }

  return new Blob([buffer], { type: "audio/wav" });
}

// 把录音 worklet 以内联模块注册到当前 AudioContext.
async function registerRecorderWorklet(audioContext: AudioContext) {
  if (!audioContext.audioWorklet) throw new Error("AudioWorklet is not available");
  if (!URL.createObjectURL) throw new Error("URL.createObjectURL is not available");

  const moduleUrl = URL.createObjectURL(new Blob([RECORDER_WORKLET_SOURCE], { type: "text/javascript" }));
  try {
    await audioContext.audioWorklet.addModule(moduleUrl);
  } finally {
    URL.revokeObjectURL(moduleUrl);
  }
}

// 读取浏览器 AudioContext 构造器, 兼容旧 WebKit 环境.
function readAudioContextConstructor(): typeof AudioContext {
  const contextWindow = globalThis as typeof globalThis & {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  };
  const AudioContextCtor = contextWindow.AudioContext || contextWindow.webkitAudioContext;
  if (!AudioContextCtor) throw new Error("AudioContext is not available");
  return AudioContextCtor;
}

// 读取 AudioWorkletNode 构造器, 当前录音链路要求现代 Chromium 支持.
function readAudioWorkletNodeConstructor(): typeof AudioWorkletNode {
  const contextWindow = globalThis as typeof globalThis & {
    AudioWorkletNode?: typeof AudioWorkletNode;
  };
  const AudioWorkletNodeCtor = contextWindow.AudioWorkletNode;
  if (!AudioWorkletNodeCtor) throw new Error("AudioWorkletNode is not available");
  return AudioWorkletNodeCtor;
}

// 安静关闭 AudioContext, 避免初始化失败时泄露音频资源.
async function closeAudioContextQuietly(audioContext: AudioContext) {
  try {
    await audioContext.close();
  } catch {
    return;
  }
}

// 安静断开音频节点, 处理初始化失败时尚未连接的节点.
function disconnectAudioNodeQuietly(node: AudioNode) {
  try {
    node.disconnect();
  } catch {
    return;
  }
}

// 把 ASCII 标记写入 WAV header.
function writeAscii(view: DataView, offset: number, value: string) {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}

// 把 Blob 读取为 data URL, 供多模态 payload 传输.
function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read recorded audio"));
    reader.readAsDataURL(blob);
  });
}
