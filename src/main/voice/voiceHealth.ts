import type { VoiceProviderStatusDto, VoiceStatusSnapshotDto } from "../../shared/ipcTypes";
import type { AppConfig } from "../config/env";

export type VoiceHealthService = {
  snapshot: () => Promise<VoiceStatusSnapshotDto>;
};

// 创建语音服务健康检查器, 腾讯云 provider 只检查配置完整性, 不做付费探活调用.
export function createVoiceHealthService(config: AppConfig, _fetchImpl: typeof fetch = fetch): VoiceHealthService {
  return {
    // 并行返回 ASR 和 TTS 状态, 缺密钥时明确显示为不可用.
    async snapshot() {
      return {
        asr: checkTencentProvider({
          enabled: config.voice.asr.enabled,
          secretId: config.voice.asr.secretId,
          secretKey: config.voice.asr.secretKey,
          baseUrl: "https://asr.tencentcloudapi.com"
        }),
        tts: checkTencentProvider({
          enabled: config.voice.tts.enabled,
          secretId: config.voice.tts.secretId,
          secretKey: config.voice.tts.secretKey,
          baseUrl: "https://tts.tencentcloudapi.com"
        })
      };
    }
  };
}

// 判断单个腾讯云 provider 是否已具备可调用条件.
function checkTencentProvider(input: {
  enabled: boolean;
  secretId: string;
  secretKey: string;
  baseUrl: string;
}): VoiceProviderStatusDto {
  if (!input.enabled) {
    return {
      provider: "tencent-cloud",
      status: "disabled",
      baseUrl: input.baseUrl,
      message: "disabled"
    };
  }
  if (!input.secretId || !input.secretKey) {
    return {
      provider: "tencent-cloud",
      status: "unreachable",
      baseUrl: input.baseUrl,
      message: "missing Tencent Cloud credentials"
    };
  }
  return {
    provider: "tencent-cloud",
    status: "ready",
    baseUrl: input.baseUrl,
    message: "configured"
  };
}
