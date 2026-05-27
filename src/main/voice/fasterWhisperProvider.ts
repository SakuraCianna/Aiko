import type { AppConfig } from "../config/env";
import type { SpeechUnderstandingProvider, SpeechUnderstandingResult } from "./voiceTypes";
import type { ChatAttachment } from "../../shared/chatPayload";

type FasterWhisperAsrConfig = AppConfig["voice"]["asr"];

// 创建 faster-whisper HTTP ASR provider, 对接本地 OpenAI-compatible 转写服务.
export function createFasterWhisperSpeechUnderstandingProvider(
  config: FasterWhisperAsrConfig,
  fetchImpl: typeof fetch = fetch
): SpeechUnderstandingProvider {
  return {
    // 逐个提交音频附件, 保留每段语音和 attachmentId 的对应关系.
    async understand(input) {
      const results: SpeechUnderstandingResult[] = [];
      for (const attachment of input.attachments) {
        results.push(await transcribeAttachment(attachment, config, fetchImpl));
      }
      return results;
    }
  };
}

// 调用本地 faster-whisper 服务完成单段音频转写.
async function transcribeAttachment(
  attachment: ChatAttachment,
  config: FasterWhisperAsrConfig,
  fetchImpl: typeof fetch
): Promise<SpeechUnderstandingResult> {
  const audioBytes = decodeAttachmentDataUrl(attachment);
  const formData = new FormData();
  formData.append("file", new Blob([audioBytes], { type: attachment.mimeType }), attachment.name);
  formData.append("model", "faster-whisper");
  if (config.language) formData.append("language", config.language);

  const response = await fetchImpl(`${config.baseUrl}/v1/audio/transcriptions`, {
    method: "POST",
    body: formData,
    signal: AbortSignal.timeout(config.timeoutMs)
  });
  if (!response.ok) {
    return {
      attachmentId: attachment.id,
      transcript: "",
      error: `faster-whisper request failed: ${response.status}`
    };
  }

  const body = await response.json() as Record<string, unknown>;
  return {
    attachmentId: attachment.id,
    transcript: readString(body.text) || readString(body.transcript),
    language: readString(body.language) || config.language,
    confidence: readNumber(body.confidence)
  };
}

// 从 data URL 中取出音频二进制, provider 层不信任 renderer 传来的原始字符串.
function decodeAttachmentDataUrl(attachment: ChatAttachment) {
  const prefix = `data:${attachment.mimeType};base64,`;
  if (!attachment.dataUrl.startsWith(prefix)) {
    throw new Error("audio data URL does not match MIME type");
  }
  return Buffer.from(attachment.dataUrl.slice(prefix.length), "base64");
}

// 安全读取字符串字段.
function readString(value: unknown) {
  return typeof value === "string" ? value : "";
}

// 安全读取数值字段.
function readNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
