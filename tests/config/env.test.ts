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
        provider: "faster-whisper",
        baseUrl: "http://127.0.0.1:9001",
        language: "zh",
        timeoutMs: 30000
      },
      tts: {
        enabled: false,
        provider: "cosyvoice",
        baseUrl: "http://127.0.0.1:9002",
        voice: "aiko",
        format: "wav",
        timeoutMs: 30000
      }
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

  it("parses faster-whisper ASR and CosyVoice TTS config", () => {
    const config = parseEnv({
      GLM_BASE_URL: "https://open.bigmodel.cn/api/paas/v4",
      GLM_MODEL: "glm-4.6v-flash",
      GLM_API_KEY: "secret-value",
      AIKO_ASR_ENABLED: "true",
      AIKO_ASR_BASE_URL: "http://127.0.0.1:9011/",
      AIKO_ASR_LANGUAGE: "zh-CN",
      AIKO_ASR_TIMEOUT_MS: "45000",
      AIKO_TTS_ENABLED: "true",
      AIKO_TTS_BASE_URL: "http://127.0.0.1:9022/",
      AIKO_TTS_VOICE: "aiko-zero-shot",
      AIKO_TTS_FORMAT: "wav",
      AIKO_TTS_TIMEOUT_MS: "50000"
    });

    expect(config.voice.asr).toEqual({
      enabled: true,
      provider: "faster-whisper",
      baseUrl: "http://127.0.0.1:9011",
      language: "zh-CN",
      timeoutMs: 45000
    });
    expect(config.voice.tts).toEqual({
      enabled: true,
      provider: "cosyvoice",
      baseUrl: "http://127.0.0.1:9022",
      voice: "aiko-zero-shot",
      format: "wav",
      timeoutMs: 50000
    });
  });
});
