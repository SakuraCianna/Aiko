import { describe, expect, it, vi } from "vitest";
import { createVoiceHealthService } from "../../src/main/voice/voiceHealth";
import type { AppConfig } from "../../src/main/config/env";

describe("createVoiceHealthService", () => {
  it("reports disabled providers without calling local services", async () => {
    const fetchMock = vi.fn() as unknown as typeof fetch;
    const service = createVoiceHealthService(baseConfig(), fetchMock);

    await expect(service.snapshot()).resolves.toMatchObject({
      asr: { provider: "tencent-cloud", status: "disabled" },
      tts: { provider: "tencent-cloud", status: "disabled" }
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports ready when Tencent Cloud providers have credentials", async () => {
    const fetchMock = vi.fn() as unknown as typeof fetch;
    const config = baseConfig({
      asrEnabled: true,
      ttsEnabled: true
    });
    const service = createVoiceHealthService(config, fetchMock);

    await expect(service.snapshot()).resolves.toMatchObject({
      asr: { provider: "tencent-cloud", status: "ready" },
      tts: { provider: "tencent-cloud", status: "ready" }
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports unreachable when enabled Tencent Cloud providers miss credentials", async () => {
    const fetchMock = vi.fn() as unknown as typeof fetch;
    const service = createVoiceHealthService(baseConfig({ asrEnabled: true, ttsEnabled: true, emptyCredentials: true }), fetchMock);

    await expect(service.snapshot()).resolves.toMatchObject({
      asr: { status: "unreachable" },
      tts: { status: "unreachable" }
    });
  });
});

function baseConfig(options: { asrEnabled?: boolean; ttsEnabled?: boolean; emptyCredentials?: boolean } = {}): AppConfig {
  const secretId = options.emptyCredentials ? "" : "akid-test";
  const secretKey = options.emptyCredentials ? "" : "secret-test";
  return {
    glm: {
      baseUrl: "https://open.bigmodel.cn/api/paas/v4",
      model: "glm-4.6v-flash",
      fallbackModels: ["glm-4v-flash"],
      apiKey: "secret"
    },
    mcp: {
      tavily: {
        enabled: false,
        mode: "stdio",
        apiKey: "",
        apiKeys: [],
        remoteUrl: "https://mcp.tavily.com/mcp/",
        packageName: "tavily-mcp@0.2.19",
        maxResults: 5,
        timeoutMs: 15000
      }
    },
    voice: {
      asr: {
        enabled: options.asrEnabled ?? false,
        provider: "tencent-cloud",
        secretId,
        secretKey,
        region: "ap-shanghai",
        engineModelType: "16k_zh",
        voiceFormat: "wav",
        language: "zh",
        timeoutMs: 30000
      },
      tts: {
        enabled: options.ttsEnabled ?? false,
        provider: "tencent-cloud",
        secretId,
        secretKey,
        region: "ap-shanghai",
        voiceType: 603007,
        voiceName: "邻家女孩",
        format: "wav",
        sampleRate: 24000,
        timeoutMs: 30000
      }
    },
    companion: {
      enabled: true,
      intervalHours: 24,
      ttsEnabled: false,
      quietStartHour: 23,
      quietEndHour: 8
    }
  };
}
