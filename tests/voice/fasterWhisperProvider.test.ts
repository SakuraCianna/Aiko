import { describe, expect, it, vi } from "vitest";
import { createFasterWhisperSpeechUnderstandingProvider } from "../../src/main/voice/fasterWhisperProvider";
import type { ChatAttachment } from "../../src/shared/chatPayload";

describe("createFasterWhisperSpeechUnderstandingProvider", () => {
  it("posts audio attachments to an OpenAI-compatible faster-whisper endpoint", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ text: "打开 Cursor", language: "zh", confidence: 0.91 })
    })) as unknown as typeof fetch;
    const provider = createFasterWhisperSpeechUnderstandingProvider(
      {
        enabled: true,
        provider: "faster-whisper",
        baseUrl: "http://127.0.0.1:9001",
        language: "zh",
        timeoutMs: 30000
      },
      fetchMock
    );

    const results = await provider.understand({ attachments: [audioAttachment()] });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:9001/v1/audio/transcriptions",
      expect.objectContaining({ method: "POST" })
    );
    expect(results).toEqual([
      {
        attachmentId: "audio-1",
        transcript: "打开 Cursor",
        language: "zh",
        confidence: 0.91
      }
    ]);
  });
});

function audioAttachment(): ChatAttachment {
  return {
    id: "audio-1",
    kind: "audio",
    name: "voice.webm",
    mimeType: "audio/webm",
    size: 3,
    dataUrl: "data:audio/webm;base64,AAAA"
  };
}
