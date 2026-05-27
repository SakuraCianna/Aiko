import { MAX_AUDIO_BYTES, type ChatAttachment } from "../../shared/chatPayload";
import type {
  SpeechStreamingProvider,
  SpeechStreamChunkInput,
  SpeechStreamFinishInput,
  SpeechStreamStartInput,
  SpeechUnderstandingProvider
} from "./voiceTypes";

type BufferedSpeechSession = {
  sessionId: string;
  sampleRate: number;
  frameMs: number;
  chunks: Buffer[];
  nextSequence: number;
  totalBytes: number;
  createdAt: number;
};

const MAX_STREAM_SESSION_AGE_MS = 5 * 60 * 1000;
const MAX_STREAM_CHUNK_BYTES = 128 * 1024;
const MAX_BUFFERED_PCM_BYTES = MAX_AUDIO_BYTES - 44;
const PCM16_BYTES_PER_SAMPLE = 2;

// 用现有一句话 ASR provider 包装出流式接口, 让 renderer 先按流式协议发送 PCM 分片.
export function createBufferedSpeechStreamingProvider(
  speechUnderstandingProvider: SpeechUnderstandingProvider,
  options: { now?: () => number } = {}
): SpeechStreamingProvider {
  const sessions = new Map<string, BufferedSpeechSession>();
  const now = options.now ?? Date.now;

  return {
    // 开启一个流式语音会话, 后续分片会按 sessionId 归并.
    async start(input) {
      assertValidStartInput(input);
      pruneExpiredSessions(sessions, now());
      sessions.set(input.sessionId, {
        sessionId: input.sessionId,
        sampleRate: input.sampleRate,
        frameMs: input.frameMs,
        chunks: [],
        nextSequence: 0,
        totalBytes: 0,
        createdAt: now()
      });
    },

    // 写入一段 PCM16LE 音频分片, 并校验顺序和总大小.
    async pushChunk(input) {
      const session = readSession(sessions, input.sessionId);
      assertValidChunkInput(input, session);
      session.chunks.push(Buffer.from(input.pcm));
      session.nextSequence += 1;
      session.totalBytes += input.pcm.byteLength;
    },

    // 结束会话时把所有 PCM16 分片封装成 WAV, 复用已有腾讯云一句话识别链路.
    async finish(input) {
      const session = readSession(sessions, input.sessionId);
      sessions.delete(input.sessionId);
      if (session.totalBytes === 0) {
        return { transcript: "", error: "No speech chunks were received" };
      }

      const wavBuffer = createPcm16WavBuffer(session.chunks, session.sampleRate);
      const attachment = createBufferedAudioAttachment(session.sessionId, wavBuffer);
      const [result] = await speechUnderstandingProvider.understand({ attachments: [attachment] });
      if (!result) return { transcript: "", error: "ASR provider returned no result" };
      return {
        transcript: result.transcript,
        confidence: result.confidence,
        language: result.language,
        error: result.error
      };
    },

    // 取消会话只清理内存中的分片, 不触发 ASR provider.
    async cancel(input) {
      sessions.delete(input.sessionId);
    }
  };
}

// 把 PCM16LE 分片封装成标准 WAV buffer.
export function createPcm16WavBuffer(chunks: Buffer[], sampleRate: number): Buffer {
  const dataBytes = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  const wavBuffer = Buffer.alloc(44 + dataBytes);
  wavBuffer.write("RIFF", 0, "ascii");
  wavBuffer.writeUInt32LE(36 + dataBytes, 4);
  wavBuffer.write("WAVE", 8, "ascii");
  wavBuffer.write("fmt ", 12, "ascii");
  wavBuffer.writeUInt32LE(16, 16);
  wavBuffer.writeUInt16LE(1, 20);
  wavBuffer.writeUInt16LE(1, 22);
  wavBuffer.writeUInt32LE(sampleRate, 24);
  wavBuffer.writeUInt32LE(sampleRate * PCM16_BYTES_PER_SAMPLE, 28);
  wavBuffer.writeUInt16LE(PCM16_BYTES_PER_SAMPLE, 32);
  wavBuffer.writeUInt16LE(16, 34);
  wavBuffer.write("data", 36, "ascii");
  wavBuffer.writeUInt32LE(dataBytes, 40);

  let offset = 44;
  for (const chunk of chunks) {
    chunk.copy(wavBuffer, offset);
    offset += chunk.byteLength;
  }
  return wavBuffer;
}

// 把 buffered WAV 构造成聊天音频附件, 继续走现有多模态输入边界.
function createBufferedAudioAttachment(sessionId: string, wavBuffer: Buffer): ChatAttachment {
  return {
    id: sessionId,
    kind: "audio",
    name: `aiko-stream-${sessionId}.wav`,
    mimeType: "audio/wav",
    size: wavBuffer.byteLength,
    dataUrl: `data:audio/wav;base64,${wavBuffer.toString("base64")}`
  };
}

// 校验新会话参数, 限制在当前 renderer 支持的 16k PCM 实时输入范围内.
function assertValidStartInput(input: SpeechStreamStartInput) {
  if (!input.sessionId || input.sessionId.length > 128) throw new Error("Invalid speech stream session id");
  if (input.sampleRate !== 16000) throw new Error("Invalid speech stream sample rate");
  if (!Number.isInteger(input.frameMs) || input.frameMs < 40 || input.frameMs > 500) {
    throw new Error("Invalid speech stream frame duration");
  }
}

// 校验分片和会话状态, 避免乱序或超大音频进入 ASR.
function assertValidChunkInput(input: SpeechStreamChunkInput, session: BufferedSpeechSession) {
  if (input.sampleRate !== session.sampleRate) throw new Error("speech stream sample rate mismatch");
  if (input.sequence !== session.nextSequence) throw new Error("speech stream chunk out of order");
  if (input.pcm.byteLength === 0) throw new Error("speech stream chunk is empty");
  if (input.pcm.byteLength > MAX_STREAM_CHUNK_BYTES) throw new Error("speech stream chunk is too large");
  if (session.totalBytes + input.pcm.byteLength > MAX_BUFFERED_PCM_BYTES) {
    throw new Error("speech stream is too large");
  }
}

// 读取活跃会话, 找不到时给出明确错误.
function readSession(sessions: Map<string, BufferedSpeechSession>, sessionId: string): BufferedSpeechSession {
  const session = sessions.get(sessionId);
  if (!session) throw new Error("speech stream session was not found");
  return session;
}

// 清理长时间未结束的流式会话, 防止录音异常后内存常驻.
function pruneExpiredSessions(sessions: Map<string, BufferedSpeechSession>, now: number) {
  for (const [sessionId, session] of sessions) {
    if (now - session.createdAt > MAX_STREAM_SESSION_AGE_MS) {
      sessions.delete(sessionId);
    }
  }
}
