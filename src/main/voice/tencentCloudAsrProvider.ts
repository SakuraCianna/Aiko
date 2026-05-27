import type { AppConfig } from "../config/env";
import type { ChatAttachment } from "../../shared/chatPayload";
import type { SpeechUnderstandingProvider, SpeechUnderstandingResult } from "./voiceTypes";
import { readString, readTencentErrorMessage, readTencentResponse, requestTencentCloudApi } from "./tencentCloudSigner";

type TencentCloudAsrConfig = AppConfig["voice"]["asr"];

const ASR_HOST = "asr.tencentcloudapi.com";
const ASR_SERVICE = "asr";
const ASR_VERSION = "2019-06-14";
const ASR_ACTION = "SentenceRecognition";

// 创建腾讯云一句话识别 provider, 用于把麦克风 WAV 附件转成文本.
export function createTencentCloudSpeechUnderstandingProvider(
  config: TencentCloudAsrConfig,
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

// 调用腾讯云 SentenceRecognition 完成单段短音频识别.
async function transcribeAttachment(
  attachment: ChatAttachment,
  config: TencentCloudAsrConfig,
  fetchImpl: typeof fetch
): Promise<SpeechUnderstandingResult> {
  try {
    const audioBytes = decodeAttachmentDataUrl(attachment);
    const body = await requestTencentCloudApi({
      action: ASR_ACTION,
      fetchImpl,
      host: ASR_HOST,
      payload: JSON.stringify(createSentenceRecognitionPayload(audioBytes, config)),
      region: config.region,
      secretId: config.secretId,
      secretKey: config.secretKey,
      service: ASR_SERVICE,
      timeoutMs: config.timeoutMs,
      version: ASR_VERSION
    });
    const error = readTencentErrorMessage(body);
    if (error) {
      return { attachmentId: attachment.id, transcript: "", error };
    }
    const response = readTencentResponse(body);
    return {
      attachmentId: attachment.id,
      transcript: readString(response.Result),
      language: config.language
    };
  } catch (error) {
    return {
      attachmentId: attachment.id,
      transcript: "",
      error: error instanceof Error ? error.message : "Tencent Cloud ASR request failed"
    };
  }
}

// 构造腾讯云一句话识别请求体, 使用 SourceType=1 上传本地音频 base64.
function createSentenceRecognitionPayload(audioBytes: Buffer, config: TencentCloudAsrConfig) {
  return {
    ProjectId: 0,
    SubServiceType: 2,
    EngSerViceType: config.engineModelType,
    SourceType: 1,
    VoiceFormat: config.voiceFormat,
    Data: audioBytes.toString("base64"),
    DataLen: audioBytes.byteLength
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
