import { describe, expect, test } from "vitest";
import { parseEnv } from "./env";

const baseEnv = {
  GLM_BASE_URL: "https://open.bigmodel.cn/api/paas/v4/",
  GLM_MODEL: "glm-4.6v-flash",
  GLM_API_KEY: "test-key"
} satisfies NodeJS.ProcessEnv;

describe("parseEnv", () => {
  test("normalizes the GLM route and keeps optional integrations disabled by default", () => {
    const config = parseEnv(baseEnv);

    expect(config.glm.baseUrl).toBe("https://open.bigmodel.cn/api/paas/v4");
    expect(config.glm.fallbackModels).toEqual(["glm-4v-flash"]);
    expect(config.mcp.tavily.enabled).toBe(false);
    expect(config.voice.asr.enabled).toBe(false);
    expect(config.voice.tts.enabled).toBe(false);
  });

  test("requires Tavily keys when Tavily MCP is enabled", () => {
    expect(() => parseEnv({ ...baseEnv, MCP_TAVILY_ENABLED: "true" })).toThrow(
      "Missing required environment variable: TAVILY_API_KEYS"
    );
  });

  test("requires Tencent credentials only when cloud voice is enabled", () => {
    expect(() => parseEnv({ ...baseEnv, AIKO_TTS_ENABLED: "true" })).toThrow(
      "Missing required environment variable: TENCENTCLOUD_SECRET_ID or TENCENTCLOUD_SECRET_KEY"
    );
  });
});
