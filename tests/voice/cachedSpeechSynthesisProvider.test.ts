import { describe, expect, it, vi } from "vitest";
import { createCachedSpeechSynthesisProvider } from "../../src/main/voice/cachedSpeechSynthesisProvider";

describe("createCachedSpeechSynthesisProvider", () => {
  it("reuses successful TTS results for identical requests", async () => {
    const synthesize = vi.fn(async () => ({
      ok: true as const,
      dataUrl: "data:audio/wav;base64,QUlLTw==",
      mimeType: "audio/wav"
    }));
    const provider = createCachedSpeechSynthesisProvider({ synthesize }, { maxEntries: 8 });

    await expect(provider.synthesize({ text: "你好", emotion: "happy", speed: 1, format: "wav" })).resolves.toMatchObject({ ok: true });
    await expect(provider.synthesize({ text: "你好", emotion: "happy", speed: 1, format: "wav" })).resolves.toMatchObject({ ok: true });

    expect(synthesize).toHaveBeenCalledTimes(1);
  });

  it("does not cache failed TTS results", async () => {
    const synthesize = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, message: "rate limited" })
      .mockResolvedValueOnce({ ok: true, dataUrl: "data:audio/wav;base64,QQ==", mimeType: "audio/wav" });
    const provider = createCachedSpeechSynthesisProvider({ synthesize }, { maxEntries: 8 });

    await expect(provider.synthesize({ text: "失败不缓存" })).resolves.toEqual({ ok: false, message: "rate limited" });
    await expect(provider.synthesize({ text: "失败不缓存" })).resolves.toMatchObject({ ok: true });

    expect(synthesize).toHaveBeenCalledTimes(2);
  });
});
