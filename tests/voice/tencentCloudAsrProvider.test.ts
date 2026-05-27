import { describe, expect, it, vi } from "vitest";
import { createTencentCloudSpeechUnderstandingProvider } from "../../src/main/voice/tencentCloudAsrProvider";
import type { ChatAttachment } from "../../src/shared/chatPayload";

describe("createTencentCloudSpeechUnderstandingProvider", () => {
  it("sends WAV audio to Tencent Cloud SentenceRecognition", async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      expect(body).toMatchObject({
        SourceType: 1,
        EngSerViceType: "16k_zh",
        VoiceFormat: "wav"
      });
      expect(body.Data).toBe(Buffer.from("RIFF-test").toString("base64"));
      return new Response(JSON.stringify({ Response: { Result: "你好 Aiko" } }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }) as unknown as typeof fetch;

    const provider = createTencentCloudSpeechUnderstandingProvider(
      {
        enabled: true,
        realtimeEnabled: false,
        appId: "",
        provider: "tencent-cloud",
        secretId: "akid-test",
        secretKey: "secret-test",
        region: "ap-shanghai",
        engineModelType: "16k_zh",
        voiceFormat: "wav",
        language: "zh",
        timeoutMs: 30000
      },
      fetchMock
    );

    await expect(provider.understand({ attachments: [audioAttachment()] })).resolves.toEqual([
      {
        attachmentId: "voice-1",
        transcript: "你好 Aiko",
        language: "zh"
      }
    ]);
    expect(fetchMock).toHaveBeenCalledWith("https://asr.tencentcloudapi.com", expect.objectContaining({ method: "POST" }));
  });
});

function audioAttachment(): ChatAttachment {
  const audio = Buffer.from("RIFF-test").toString("base64");
  return {
    id: "voice-1",
    kind: "audio",
    name: "voice.wav",
    mimeType: "audio/wav",
    size: 9,
    dataUrl: `data:audio/wav;base64,${audio}`
  };
}
