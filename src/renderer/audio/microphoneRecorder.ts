import type { ChatAttachment } from "../../shared/chatPayload";

export type WavAudioRecorder = {
  stop: () => Promise<Blob>;
};

// 创建浏览器内 WAV 录音器, 让腾讯云一句话识别可以直接读取麦克风音频.
export async function createWavAudioRecorder(stream: MediaStream): Promise<WavAudioRecorder> {
  const AudioContextCtor = readAudioContextConstructor();
  const audioContext = new AudioContextCtor({ sampleRate: 16000 });
  const source = audioContext.createMediaStreamSource(stream);
  const processor = audioContext.createScriptProcessor(4096, 1, 1);
  const silentGain = audioContext.createGain();
  const chunks: Float32Array[] = [];
  let stopped = false;

  silentGain.gain.value = 0;
  processor.onaudioprocess = (event) => {
    if (stopped) return;
    chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
  };
  source.connect(processor);
  processor.connect(silentGain);
  silentGain.connect(audioContext.destination);

  return {
    // 停止录音并把 PCM 样本封装为 WAV Blob.
    async stop() {
      if (stopped) return createPcm16WavBlob(chunks, audioContext.sampleRate);
      stopped = true;
      source.disconnect();
      processor.disconnect();
      silentGain.disconnect();
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
