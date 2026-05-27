import { describe, expect, it, vi } from "vitest";
import { createTencentCloudSpeechSynthesisProvider } from "../../src/main/voice/tencentCloudTtsProvider";

describe("createTencentCloudSpeechSynthesisProvider", () => {
  it("uses the selected cute Tencent Cloud voice and returns playable audio", async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      expect(body).toMatchObject({
        Text: "你好呀",
        VoiceType: 603007,
        Codec: "wav",
        SampleRate: 24000
      });
      return new Response(
        JSON.stringify({
          Response: {
            Audio: Buffer.from("audio-bytes").toString("base64"),
            RequestId: "request-1"
          }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }) as unknown as typeof fetch;

    const provider = createTencentCloudSpeechSynthesisProvider(
      {
        enabled: true,
        provider: "tencent-cloud",
        secretId: "akid-test",
        secretKey: "secret-test",
        region: "ap-shanghai",
        voiceType: 603007,
        voiceName: "邻家女孩",
        format: "wav",
        sampleRate: 24000,
        timeoutMs: 30000
      },
      fetchMock
    );

    await expect(provider.synthesize({ text: "你好呀", emotion: "happy" })).resolves.toEqual({
      ok: true,
      dataUrl: `data:audio/wav;base64,${Buffer.from("audio-bytes").toString("base64")}`,
      mimeType: "audio/wav"
    });
    expect(fetchMock).toHaveBeenCalledWith("https://tts.tencentcloudapi.com", expect.objectContaining({ method: "POST" }));
  });
});
