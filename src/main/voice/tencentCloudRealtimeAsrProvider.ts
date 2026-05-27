import { createHmac } from "node:crypto";
import type { AppConfig } from "../config/env";
import type {
  SpeechStreamingProvider,
  SpeechStreamChunkInput,
  SpeechStreamFinishInput,
  SpeechStreamFinishResult,
  SpeechStreamStartInput
} from "./voiceTypes";

type TencentCloudRealtimeAsrConfig = AppConfig["voice"]["asr"];

type TencentRealtimeAsrProviderOptions = {
  WebSocketCtor?: typeof WebSocket;
  nowSeconds?: () => number;
  nonce?: () => number;
  voiceId?: () => string;
};

type RealtimeAsrSession = {
  sessionId: string;
  socket: WebSocket;
  language: string;
  latestTranscript: string;
  onTranscript?: SpeechStreamStartInput["onTranscript"];
  finish?: {
    resolve: (result: SpeechStreamFinishResult) => void;
    reject: (error: Error) => void;
  };
};

const REALTIME_ASR_HOST = "asr.cloud.tencent.com";
const REALTIME_ASR_PATH_PREFIX = "/asr/v2";
const REALTIME_VOICE_FORMAT_PCM = 1;

// 创建腾讯云实时 ASR WebSocket provider, 支持 partial transcript 回传.
export function createTencentCloudRealtimeAsrProvider(
  config: TencentCloudRealtimeAsrConfig,
  options: TencentRealtimeAsrProviderOptions = {}
): SpeechStreamingProvider {
  const sessions = new Map<string, RealtimeAsrSession>();
  const WebSocketCtor = options.WebSocketCtor ?? WebSocket;
  const nowSeconds = options.nowSeconds ?? (() => Math.floor(Date.now() / 1000));
  const nonce = options.nonce ?? (() => Math.floor(Math.random() * 1_000_000_000));
  const voiceId = options.voiceId ?? (() => crypto.randomUUID());

  return {
    // 打开腾讯云实时 ASR WebSocket, 后续 pushChunk 会直接发送 PCM16LE 分片.
    async start(input) {
      assertRealtimeConfig(config);
      const socket = new WebSocketCtor(createRealtimeAsrUrl(config, {
        nowSeconds: nowSeconds(),
        nonce: nonce(),
        voiceId: voiceId()
      }));
      const session: RealtimeAsrSession = {
        sessionId: input.sessionId,
        socket,
        language: config.language,
        latestTranscript: "",
        onTranscript: input.onTranscript
      };
      sessions.set(input.sessionId, session);
      attachSocketHandlers(session, sessions);
      await waitForSocketOpen(socket, config.timeoutMs);
    },

    // 将 renderer 传来的 PCM16LE 分片发送给腾讯云.
    async pushChunk(input: SpeechStreamChunkInput) {
      const session = readSession(sessions, input.sessionId);
      if (input.sampleRate !== 16000) throw new Error("Tencent realtime ASR requires 16k PCM");
      if (session.socket.readyState !== WebSocketCtor.OPEN) throw new Error("Tencent realtime ASR socket is not open");
      session.socket.send(input.pcm);
    },

    // 发送结束帧并等待腾讯云 final 结果.
    async finish(input: SpeechStreamFinishInput) {
      const session = readSession(sessions, input.sessionId);
      if (session.socket.readyState !== WebSocketCtor.OPEN) {
        sessions.delete(input.sessionId);
        return { transcript: session.latestTranscript, language: session.language };
      }

      session.socket.send(JSON.stringify({ type: "end" }));
      return new Promise<SpeechStreamFinishResult>((resolve, reject) => {
        session.finish = {
          resolve: (result) => {
            sessions.delete(input.sessionId);
            closeSocketQuietly(session.socket);
            resolve(result);
          },
          reject: (error) => {
            sessions.delete(input.sessionId);
            closeSocketQuietly(session.socket);
            reject(error);
          }
        };
      });
    },

    // 取消实时识别并关闭 WebSocket.
    async cancel(input) {
      const session = sessions.get(input.sessionId);
      sessions.delete(input.sessionId);
      if (session) closeSocketQuietly(session.socket);
    }
  };
}

// 生成腾讯云实时 ASR WebSocket URL 和 HMAC-SHA1 签名.
export function createRealtimeAsrUrl(
  config: TencentCloudRealtimeAsrConfig,
  input: { nowSeconds: number; nonce: number; voiceId: string }
) {
  assertRealtimeConfig(config);
  const path = `${REALTIME_ASR_PATH_PREFIX}/${config.appId}`;
  const params = new URLSearchParams({
    convert_num_mode: "1",
    engine_model_type: config.engineModelType,
    expired: String(input.nowSeconds + 24 * 60 * 60),
    filter_dirty: "0",
    filter_modal: "0",
    filter_punc: "0",
    needvad: "1",
    nonce: String(input.nonce),
    secretid: config.secretId,
    timestamp: String(input.nowSeconds),
    voice_format: String(REALTIME_VOICE_FORMAT_PCM),
    voice_id: input.voiceId,
    word_info: "0"
  });
  const sortedParams = [...params.entries()].sort(([left], [right]) => left.localeCompare(right));
  const unsignedQuery = sortedParams.map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join("&");
  const signaturePayload = `${REALTIME_ASR_HOST}${path}?${unsignedQuery}`;
  const signature = createHmac("sha1", config.secretKey).update(signaturePayload).digest("base64");
  return `wss://${REALTIME_ASR_HOST}${path}?${unsignedQuery}&signature=${encodeURIComponent(signature)}`;
}

// 绑定 WebSocket 事件, 把腾讯云返回的分片转成内部 transcript delta.
function attachSocketHandlers(session: RealtimeAsrSession, sessions: Map<string, RealtimeAsrSession>) {
  session.socket.onmessage = (event) => {
    const payload = parseTencentRealtimeMessage(event.data);
    if (!payload) return;
    if (payload.code !== 0) {
      session.finish?.reject(new Error(payload.message || "Tencent realtime ASR failed"));
      return;
    }

    const text = payload.result?.voice_text_str?.trim() ?? "";
    if (text) {
      const isFinal = payload.final === 1 || payload.result?.slice_type === 2;
      session.latestTranscript = text;
      session.onTranscript?.({
        sessionId: session.sessionId,
        sequence: payload.result?.index ?? 0,
        text,
        isFinal,
        language: session.language
      });
    }

    if (payload.final === 1 && session.finish) {
      session.finish.resolve({
        transcript: session.latestTranscript,
        language: session.language
      });
    }
  };
  session.socket.onerror = () => {
    session.finish?.reject(new Error("Tencent realtime ASR socket error"));
  };
  session.socket.onclose = () => {
    sessions.delete(session.sessionId);
  };
}

// 等待 WebSocket 打开, 超时则释放连接.
function waitForSocketOpen(socket: WebSocket, timeoutMs: number) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      closeSocketQuietly(socket);
      reject(new Error("Tencent realtime ASR socket open timeout"));
    }, timeoutMs);
    socket.onopen = () => {
      clearTimeout(timer);
      resolve();
    };
    socket.onerror = () => {
      clearTimeout(timer);
      reject(new Error("Tencent realtime ASR socket error"));
    };
  });
}

// 腾讯云实时 ASR 返回 JSON 字符串, 非 JSON 直接忽略.
function parseTencentRealtimeMessage(data: unknown): {
  code: number;
  message?: string;
  final?: number;
  result?: {
    index?: number;
    slice_type?: number;
    voice_text_str?: string;
  };
} | null {
  if (typeof data !== "string") return null;
  try {
    const parsed = JSON.parse(data) as {
      code?: unknown;
      message?: unknown;
      final?: unknown;
      result?: {
        index?: unknown;
        slice_type?: unknown;
        voice_text_str?: unknown;
      };
    };
    return {
      code: typeof parsed.code === "number" ? parsed.code : -1,
      message: typeof parsed.message === "string" ? parsed.message : undefined,
      final: typeof parsed.final === "number" ? parsed.final : undefined,
      result: parsed.result
        ? {
            index: typeof parsed.result.index === "number" ? parsed.result.index : undefined,
            slice_type: typeof parsed.result.slice_type === "number" ? parsed.result.slice_type : undefined,
            voice_text_str: typeof parsed.result.voice_text_str === "string" ? parsed.result.voice_text_str : undefined
          }
        : undefined
    };
  } catch {
    return null;
  }
}

// 检查实时 ASR 必需配置, 错误在 provider 边界尽早暴露.
function assertRealtimeConfig(config: TencentCloudRealtimeAsrConfig) {
  if (!config.appId) throw new Error("Tencent realtime ASR requires TENCENTCLOUD_APP_ID");
  if (!config.secretId || !config.secretKey) throw new Error("Tencent realtime ASR requires credentials");
}

// 读取活跃会话, 找不到时返回明确错误.
function readSession(sessions: Map<string, RealtimeAsrSession>, sessionId: string) {
  const session = sessions.get(sessionId);
  if (!session) throw new Error("Tencent realtime ASR session was not found");
  return session;
}

// 关闭 socket 时不让异常逃出清理路径.
function closeSocketQuietly(socket: WebSocket) {
  try {
    socket.close();
  } catch {
    return;
  }
}
