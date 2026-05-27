import { describe, expect, it, vi } from "vitest";
import { createVoiceHealthService } from "../../src/main/voice/voiceHealth";
import type { AppConfig } from "../../src/main/config/env";

describe("createVoiceHealthService", () => {
  it("reports disabled providers without calling local services", async () => {
    const fetchMock = vi.fn() as unknown as typeof fetch;
    const service = createVoiceHealthService(baseConfig(), fetchMock);

    await expect(service.snapshot()).resolves.toMatchObject({
      asr: { provider: "faster-whisper", status: "disabled" },
      tts: { provider: "cosyvoice", status: "disabled" }
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports ready when enabled local services answer /health", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true })) as unknown as typeof fetch;
    const config = baseConfig({
      asrEnabled: true,
      ttsEnabled: true
    });
    const service = createVoiceHealthService(config, fetchMock);

    await expect(service.snapshot()).resolves.toMatchObject({
      asr: { provider: "faster-whisper", status: "ready" },
      tts: { provider: "cosyvoice", status: "ready" }
    });
    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:9001/health", expect.objectContaining({ method: "GET" }));
    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:9002/health", expect.objectContaining({ method: "GET" }));
  });

  it("reports unreachable when a configured local service fails", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    const service = createVoiceHealthService(baseConfig({ asrEnabled: true, ttsEnabled: true }), fetchMock);

    await expect(service.snapshot()).resolves.toMatchObject({
      asr: { status: "unreachable" },
      tts: { status: "unreachable" }
    });
  });
});

function baseConfig(options: { asrEnabled?: boolean; ttsEnabled?: boolean } = {}): AppConfig {
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
        provider: "faster-whisper",
        baseUrl: "http://127.0.0.1:9001",
        language: "zh",
        timeoutMs: 30000
      },
      tts: {
        enabled: options.ttsEnabled ?? false,
        provider: "cosyvoice",
        baseUrl: "http://127.0.0.1:9002",
        voice: "aiko",
        format: "wav",
        timeoutMs: 30000
      }
    }
  };
}
