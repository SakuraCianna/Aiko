import { describe, expect, it, vi } from "vitest";
import { createCosyVoiceSpeechSynthesisProvider } from "../../src/main/voice/cosyVoiceProvider";

describe("createCosyVoiceSpeechSynthesisProvider", () => {
  it("posts speech text to the local CosyVoice service and returns an audio data URL", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => ({
      ok: true,
      headers: new Headers({ "content-type": "audio/wav" }),
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
      json: async () => ({})
    })) as unknown as typeof fetch;
    const provider = createCosyVoiceSpeechSynthesisProvider(
      {
        enabled: true,
        provider: "cosyvoice",
        baseUrl: "http://127.0.0.1:9002",
        voice: "aiko",
        format: "wav",
        timeoutMs: 30000
      },
      fetchMock
    );

    const result = await provider.synthesize({
      text: "你好呀",
      voiceProfileId: "aiko",
      emotion: "happy",
      speed: 1,
      format: "wav"
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:9002/v1/audio/speech",
      expect.objectContaining({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: expect.stringContaining("你好呀")
      })
    );
    expect(result).toEqual({
      ok: true,
      dataUrl: "data:audio/wav;base64,AQID",
      mimeType: "audio/wav"
    });
  });
});
