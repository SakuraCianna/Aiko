import type { VoiceProviderStatusDto, VoiceStatusSnapshotDto } from "../../shared/ipcTypes";
import type { AppConfig } from "../config/env";

export type VoiceHealthService = {
  snapshot: () => Promise<VoiceStatusSnapshotDto>;
};

// 创建语音服务健康检查器, 用于设置面板展示 ASR/TTS 是否真实接通.
export function createVoiceHealthService(config: AppConfig, fetchImpl: typeof fetch = fetch): VoiceHealthService {
  return {
    // 并行检查 ASR 和 TTS 状态, 失败时返回 unreachable 而不是抛出异常.
    async snapshot() {
      const [asr, tts] = await Promise.all([
        checkProvider({
          enabled: config.voice.asr.enabled,
          provider: config.voice.asr.provider,
          baseUrl: config.voice.asr.baseUrl,
          timeoutMs: config.voice.asr.timeoutMs,
          fetchImpl
        }),
        checkProvider({
          enabled: config.voice.tts.enabled,
          provider: config.voice.tts.provider,
          baseUrl: config.voice.tts.baseUrl,
          timeoutMs: config.voice.tts.timeoutMs,
          fetchImpl
        })
      ]);
      return { asr, tts };
    }
  };
}

// 检查单个本地 provider 的 /health endpoint.
async function checkProvider(input: {
  enabled: boolean;
  provider: VoiceProviderStatusDto["provider"];
  baseUrl: string;
  timeoutMs: number;
  fetchImpl: typeof fetch;
}): Promise<VoiceProviderStatusDto> {
  if (!input.enabled) {
    return {
      provider: input.provider,
      status: "disabled",
      baseUrl: input.baseUrl,
      message: "disabled"
    };
  }

  try {
    const response = await input.fetchImpl(`${input.baseUrl}/health`, {
      method: "GET",
      signal: AbortSignal.timeout(input.timeoutMs)
    });
    if (response.ok) {
      return {
        provider: input.provider,
        status: "ready",
        baseUrl: input.baseUrl,
        message: "ready"
      };
    }
    return {
      provider: input.provider,
      status: "unreachable",
      baseUrl: input.baseUrl,
      message: `health check failed: ${response.status}`
    };
  } catch {
    return {
      provider: input.provider,
      status: "unreachable",
      baseUrl: input.baseUrl,
      message: "health check unreachable"
    };
  }
}
