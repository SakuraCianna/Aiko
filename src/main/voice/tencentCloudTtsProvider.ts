import type { AppConfig } from "../config/env";
import type { SpeechSynthesisInput, SpeechSynthesisProvider, SpeechSynthesisResult } from "./voiceTypes";
import { readString, readTencentErrorMessage, readTencentResponse, requestTencentCloudApi } from "./tencentCloudSigner";

type TencentCloudTtsConfig = AppConfig["voice"]["tts"];

const TTS_HOST = "tts.tencentcloudapi.com";
const TTS_SERVICE = "tts";
const TTS_VERSION = "2019-08-23";
const TTS_ACTION = "TextToVoice";

// 创建腾讯云 TTS provider, 默认使用适合 Aiko 的超自然大模型少女音色.
export function createTencentCloudSpeechSynthesisProvider(
  config: TencentCloudTtsConfig,
  fetchImpl: typeof fetch = fetch
): SpeechSynthesisProvider {
  return {
    // 合成一段回复音频, 返回 data URL 让 renderer 直接播放.
    async synthesize(input) {
      try {
        const body = await requestTencentCloudApi({
          action: TTS_ACTION,
          fetchImpl,
          host: TTS_HOST,
          payload: JSON.stringify(createTextToVoicePayload(input, config)),
          region: config.region,
          secretId: config.secretId,
          secretKey: config.secretKey,
          service: TTS_SERVICE,
          timeoutMs: config.timeoutMs,
          version: TTS_VERSION
        });
        const error = readTencentErrorMessage(body);
        if (error) return { ok: false, message: error };
        return readSpeechResponse(body, input, config);
      } catch (error) {
        return {
          ok: false,
          message: error instanceof Error ? error.message : "Tencent Cloud TTS request failed"
        };
      }
    }
  };
}

// 构造腾讯云 TextToVoice 请求体, VoiceType 默认指向邻家女孩音色.
function createTextToVoicePayload(input: SpeechSynthesisInput, config: TencentCloudTtsConfig) {
  return {
    Text: input.text,
    SessionId: crypto.randomUUID(),
    VoiceType: readRequestedVoiceType(input.voiceProfileId) ?? config.voiceType,
    Codec: input.format || config.format,
    SampleRate: config.sampleRate,
    Speed: toTencentSpeechSpeed(input.speed),
    Volume: 5
  };
}

// 从 voiceProfileId 中读取显式传入的腾讯云音色编号.
function readRequestedVoiceType(voiceProfileId: string | undefined): number | undefined {
  if (!voiceProfileId) return undefined;
  const parsed = Number(voiceProfileId);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

// 把 Aiko 内部语速倍率转换为腾讯云 TTS 的整数语速.
function toTencentSpeechSpeed(speed: number | undefined) {
  if (speed === undefined) return 0;
  const normalized = Math.round((speed - 1) * 4);
  return Math.max(-2, Math.min(6, normalized));
}

// 读取腾讯云返回的 base64 音频并转换为 renderer 可播放的 data URL.
function readSpeechResponse(
  body: Record<string, unknown>,
  input: SpeechSynthesisInput,
  config: TencentCloudTtsConfig
): SpeechSynthesisResult {
  const response = readTencentResponse(body);
  const audio = readString(response.Audio);
  if (!audio) return { ok: false, message: "Tencent Cloud TTS response did not include audio" };
  const format = input.format || config.format;
  const mimeType = format === "mp3" ? "audio/mpeg" : "audio/wav";
  return {
    ok: true,
    dataUrl: `data:${mimeType};base64,${audio}`,
    mimeType
  };
}
