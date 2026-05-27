import { describe, expect, it } from "vitest";
import { parseEnv } from "../../src/main/config/env";

describe("parseEnv", () => {
  it("returns GLM config when required values are present", () => {
    const config = parseEnv({
      GLM_BASE_URL: "https://open.bigmodel.cn/api/paas/v4",
      GLM_MODEL: "glm-4.6v-flash",
      GLM_API_KEY: "secret-value"
    });

    expect(config.glm.baseUrl).toBe("https://open.bigmodel.cn/api/paas/v4");
    expect(config.glm.model).toBe("glm-4.6v-flash");
    expect(config.glm.fallbackModels).toEqual(["glm-4v-flash"]);
    expect(config.glm.apiKey).toBe("secret-value");
    expect(config.mcp.tavily).toMatchObject({
      enabled: false,
      mode: "stdio",
      apiKey: "",
      apiKeys: [],
      packageName: "tavily-mcp@0.2.19",
      maxResults: 5,
      timeoutMs: 15000
    });
    expect(config.voice).toEqual({
      asr: {
        enabled: false,
        provider: "tencent-cloud",
        secretId: "",
        secretKey: "",
        region: "ap-shanghai",
        engineModelType: "16k_zh",
        voiceFormat: "wav",
        language: "zh",
        timeoutMs: 30000
      },
      tts: {
        enabled: false,
        provider: "tencent-cloud",
        secretId: "",
        secretKey: "",
        region: "ap-shanghai",
        voiceType: 603007,
        voiceName: "邻家女孩",
        format: "wav",
        sampleRate: 24000,
        timeoutMs: 30000
      }
    });
    expect(config.companion).toEqual({
      enabled: true,
      intervalHours: 24,
      ttsEnabled: false,
      quietStartHour: 23,
      quietEndHour: 8
    });
  });

  it("parses optional GLM fallback model route without duplicates", () => {
    const config = parseEnv({
      GLM_BASE_URL: "https://open.bigmodel.cn/api/paas/v4/",
      GLM_MODEL: "glm-4.6v-flash",
      GLM_FALLBACK_MODELS: "glm-4v-flash, glm-4.6v-flash, glm-4-flash",
      GLM_API_KEY: "secret-value"
    });

    expect(config.glm.baseUrl).toBe("https://open.bigmodel.cn/api/paas/v4");
    expect(config.glm.fallbackModels).toEqual(["glm-4v-flash", "glm-4-flash"]);
  });

  it("throws without printing the API key when required values are missing", () => {
    expect(() => parseEnv({ GLM_API_KEY: "secret-value" })).toThrow(
      "Missing required environment variable: GLM_BASE_URL"
    );
  });

  it("parses Tavily MCP config when web search is enabled", () => {
    const config = parseEnv({
      GLM_BASE_URL: "https://open.bigmodel.cn/api/paas/v4",
      GLM_MODEL: "glm-4.6v-flash",
      GLM_API_KEY: "secret-value",
      MCP_TAVILY_ENABLED: "true",
      MCP_TAVILY_MODE: "remote",
      MCP_TAVILY_REMOTE_URL: "https://mcp.tavily.com/mcp/",
      MCP_TAVILY_PACKAGE: "tavily-mcp@0.2.19",
      MCP_TAVILY_MAX_RESULTS: "3",
      MCP_TAVILY_TIMEOUT_MS: "12000",
      TAVILY_API_KEYS: "tvly-secret-1, tvly-secret-2, tvly-secret-1"
    });

    expect(config.mcp.tavily).toEqual({
      enabled: true,
      mode: "remote",
      apiKey: "tvly-secret-1",
      apiKeys: ["tvly-secret-1", "tvly-secret-2"],
      remoteUrl: "https://mcp.tavily.com/mcp/",
      packageName: "tavily-mcp@0.2.19",
      maxResults: 3,
      timeoutMs: 12000
    });
  });

  it("requires a Tavily API key only when Tavily MCP is explicitly enabled", () => {
    expect(() =>
      parseEnv({
        GLM_BASE_URL: "https://open.bigmodel.cn/api/paas/v4",
        GLM_MODEL: "glm-4.6v-flash",
        GLM_API_KEY: "secret-value",
        MCP_TAVILY_ENABLED: "true"
      })
    ).toThrow("Missing required environment variable: TAVILY_API_KEY or TAVILY_API_KEYS");
  });

  it("falls back to the legacy single Tavily API key when the key list is not configured", () => {
    const config = parseEnv({
      GLM_BASE_URL: "https://open.bigmodel.cn/api/paas/v4",
      GLM_MODEL: "glm-4.6v-flash",
      GLM_API_KEY: "secret-value",
      MCP_TAVILY_ENABLED: "true",
      TAVILY_API_KEY: "tvly-single"
    });

    expect(config.mcp.tavily.apiKey).toBe("tvly-single");
    expect(config.mcp.tavily.apiKeys).toEqual(["tvly-single"]);
  });

  it("rejects unapproved Tavily MCP package names", () => {
    expect(() =>
      parseEnv({
        GLM_BASE_URL: "https://open.bigmodel.cn/api/paas/v4",
        GLM_MODEL: "glm-4.6v-flash",
        GLM_API_KEY: "secret-value",
        MCP_TAVILY_ENABLED: "true",
        TAVILY_API_KEY: "tvly-single",
        MCP_TAVILY_PACKAGE: "unknown-mcp-server@latest"
      })
    ).toThrow("Invalid MCP_TAVILY_PACKAGE");
  });

  it("rejects unapproved Tavily remote MCP hosts", () => {
    expect(() =>
      parseEnv({
        GLM_BASE_URL: "https://open.bigmodel.cn/api/paas/v4",
        GLM_MODEL: "glm-4.6v-flash",
        GLM_API_KEY: "secret-value",
        MCP_TAVILY_ENABLED: "true",
        TAVILY_API_KEY: "tvly-single",
        MCP_TAVILY_MODE: "remote",
        MCP_TAVILY_REMOTE_URL: "https://example.com/mcp"
      })
    ).toThrow("Invalid MCP_TAVILY_REMOTE_URL");
  });

  it("parses Tencent Cloud ASR and TTS config", () => {
    const config = parseEnv({
      GLM_BASE_URL: "https://open.bigmodel.cn/api/paas/v4",
      GLM_MODEL: "glm-4.6v-flash",
      GLM_API_KEY: "secret-value",
      AIKO_ASR_ENABLED: "true",
      TENCENTCLOUD_SECRET_ID: "akid-test",
      TENCENTCLOUD_SECRET_KEY: "secret-test",
      TENCENTCLOUD_REGION: "ap-guangzhou",
      AIKO_ASR_ENGINE_MODEL_TYPE: "16k_zh",
      AIKO_ASR_VOICE_FORMAT: "wav",
      AIKO_ASR_LANGUAGE: "zh-CN",
      AIKO_ASR_TIMEOUT_MS: "45000",
      AIKO_TTS_ENABLED: "true",
      AIKO_TTS_VOICE_TYPE: "603007",
      AIKO_TTS_VOICE_NAME: "邻家女孩",
      AIKO_TTS_FORMAT: "wav",
      AIKO_TTS_SAMPLE_RATE: "24000",
      AIKO_TTS_TIMEOUT_MS: "50000"
    });

    expect(config.voice.asr).toEqual({
      enabled: true,
      provider: "tencent-cloud",
      secretId: "akid-test",
      secretKey: "secret-test",
      region: "ap-guangzhou",
      engineModelType: "16k_zh",
      voiceFormat: "wav",
      language: "zh-CN",
      timeoutMs: 45000
    });
    expect(config.voice.tts).toEqual({
      enabled: true,
      provider: "tencent-cloud",
      secretId: "akid-test",
      secretKey: "secret-test",
      region: "ap-guangzhou",
      voiceType: 603007,
      voiceName: "邻家女孩",
      format: "wav",
      sampleRate: 24000,
      timeoutMs: 50000
    });
  });

  it("requires Tencent Cloud credentials only when a cloud voice provider is enabled", () => {
    expect(() =>
      parseEnv({
        GLM_BASE_URL: "https://open.bigmodel.cn/api/paas/v4",
        GLM_MODEL: "glm-4.6v-flash",
        GLM_API_KEY: "secret-value",
        AIKO_ASR_ENABLED: "true"
      })
    ).toThrow("Missing required environment variable: TENCENTCLOUD_SECRET_ID or TENCENTCLOUD_SECRET_KEY");
  });

  it("parses companion heartbeat config for proactive desktop-pet presence", () => {
    const config = parseEnv({
      GLM_BASE_URL: "https://open.bigmodel.cn/api/paas/v4",
      GLM_MODEL: "glm-4.6v-flash",
      GLM_API_KEY: "secret-value",
      AIKO_COMPANION_ENABLED: "false",
      AIKO_COMPANION_INTERVAL_HOURS: "12",
      AIKO_COMPANION_TTS_ENABLED: "true",
      AIKO_COMPANION_QUIET_START_HOUR: "22",
      AIKO_COMPANION_QUIET_END_HOUR: "7"
    });

    expect(config.companion).toEqual({
      enabled: false,
      intervalHours: 12,
      ttsEnabled: true,
      quietStartHour: 22,
      quietEndHour: 7
    });
  });
});
