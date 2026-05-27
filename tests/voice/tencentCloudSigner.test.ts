import { describe, expect, it } from "vitest";
import { createTencentCloudHeaders } from "../../src/main/voice/tencentCloudSigner";

describe("createTencentCloudHeaders", () => {
  it("creates TC3 headers without exposing the secret key", () => {
    const headers = createTencentCloudHeaders({
      action: "TextToVoice",
      host: "tts.tencentcloudapi.com",
      payload: JSON.stringify({ Text: "你好" }),
      region: "ap-shanghai",
      secretId: "akid-test",
      secretKey: "secret-test",
      service: "tts",
      timestamp: 1700000000,
      version: "2019-08-23"
    });

    expect(headers["Authorization"]).toContain("TC3-HMAC-SHA256 Credential=akid-test/");
    expect(headers["Authorization"]).toContain("SignedHeaders=content-type;host;x-tc-action");
    expect(headers["Authorization"]).not.toContain("secret-test");
    expect(headers["X-TC-Action"]).toBe("TextToVoice");
    expect(headers["X-TC-Version"]).toBe("2019-08-23");
  });
});
