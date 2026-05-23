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
});
