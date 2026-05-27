import type { AppConfig } from "../config/env";
import type { SpeechSynthesisInput, SpeechSynthesisProvider, SpeechSynthesisResult } from "./voiceTypes";

type CosyVoiceTtsConfig = AppConfig["voice"]["tts"];

// 创建 CosyVoice HTTP TTS provider, 面向本地高质量中文语音服务.
export function createCosyVoiceSpeechSynthesisProvider(
  config: CosyVoiceTtsConfig,
  fetchImpl: typeof fetch = fetch
): SpeechSynthesisProvider {
  return {
    // 合成一段回复音频, 返回 data URL 让 renderer 直接播放.
    async synthesize(input) {
      const response = await fetchImpl(`${config.baseUrl}/v1/audio/speech`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(createCosyVoicePayload(input, config)),
        signal: AbortSignal.timeout(config.timeoutMs)
      });

      if (!response.ok) {
        return { ok: false, message: `CosyVoice request failed: ${response.status}` };
      }

      return readSpeechResponse(response, config);
    }
  };
}

// 构造本地 TTS 服务请求体, 保留 emotion 和 speed 以便驱动角色语气.
function createCosyVoicePayload(input: SpeechSynthesisInput, config: CosyVoiceTtsConfig) {
  return {
    model: "cosyvoice",
    input: input.text,
    voice: input.voiceProfileId || config.voice,
    emotion: input.emotion || "neutral",
    speed: input.speed ?? 1,
    response_format: input.format || config.format
  };
}

// 读取音频响应, 同时兼容二进制音频和 JSON base64 两种本地服务形态.
async function readSpeechResponse(response: Response, config: CosyVoiceTtsConfig): Promise<SpeechSynthesisResult> {
  const contentType = response.headers.get("content-type") || `audio/${config.format}`;
  if (contentType.includes("application/json")) {
    const body = await response.json() as Record<string, unknown>;
    const dataUrl = readString(body.dataUrl) || readString(body.audioDataUrl);
    if (dataUrl) return { ok: true, dataUrl, mimeType: readString(body.mimeType) || `audio/${config.format}` };
    const audioBase64 = readString(body.audio_base64) || readString(body.audioBase64);
    const mimeType = readString(body.mime_type) || readString(body.mimeType) || `audio/${config.format}`;
    if (audioBase64) return { ok: true, dataUrl: `data:${mimeType};base64,${audioBase64}`, mimeType };
    return { ok: false, message: "CosyVoice response did not include audio data" };
  }

  const audio = Buffer.from(await response.arrayBuffer());
  const mimeType = contentType.split(";")[0] || `audio/${config.format}`;
  return {
    ok: true,
    dataUrl: `data:${mimeType};base64,${audio.toString("base64")}`,
    mimeType
  };
}

// 安全读取字符串字段.
function readString(value: unknown) {
  return typeof value === "string" ? value : "";
}
