import { describe, expect, it } from "vitest";
import { createBufferedSpeechStreamingProvider } from "../../src/main/voice/bufferedSpeechStreamingProvider";
import type { ChatAttachment } from "../../src/shared/chatPayload";

describe("createBufferedSpeechStreamingProvider", () => {
  it("buffers PCM stream chunks and submits one WAV attachment to the existing ASR provider", async () => {
    let receivedAttachment: ChatAttachment | undefined;
    const provider = createBufferedSpeechStreamingProvider({
      async understand(input) {
        receivedAttachment = input.attachments[0];
        return [
          {
            attachmentId: input.attachments[0]?.id ?? "",
            transcript: "打开浏览器",
            confidence: 0.91,
            language: "zh"
          }
        ];
      }
    });

    await provider.start({ sessionId: "stream-1", sampleRate: 16000, frameMs: 200 });
    await provider.pushChunk({
      sessionId: "stream-1",
      sequence: 0,
      sampleRate: 16000,
      pcm: Buffer.from([0x00, 0x00, 0xff, 0x7f]),
      isFinal: false
    });

    await expect(provider.finish({ sessionId: "stream-1" })).resolves.toEqual({
      transcript: "打开浏览器",
      confidence: 0.91,
      language: "zh"
    });
    expect(receivedAttachment).toMatchObject({
      id: "stream-1",
      kind: "audio",
      name: "aiko-stream-stream-1.wav",
      mimeType: "audio/wav"
    });

    const audioBytes = Buffer.from(receivedAttachment?.dataUrl.split(",")[1] ?? "", "base64");
    expect(audioBytes.toString("ascii", 0, 4)).toBe("RIFF");
    expect(audioBytes.toString("ascii", 8, 12)).toBe("WAVE");
  });

  it("rejects out-of-order stream chunks before they reach ASR", async () => {
    const provider = createBufferedSpeechStreamingProvider({
      async understand() {
        throw new Error("should not call ASR");
      }
    });

    await provider.start({ sessionId: "stream-2", sampleRate: 16000, frameMs: 200 });

    await expect(provider.pushChunk({
      sessionId: "stream-2",
      sequence: 1,
      sampleRate: 16000,
      pcm: Buffer.from([0x00, 0x00])
    })).rejects.toThrow("out of order");
  });

  it("keeps the final WAV under the shared audio attachment limit", async () => {
    const provider = createBufferedSpeechStreamingProvider({
      async understand() {
        return [];
      }
    });

    await provider.start({ sessionId: "stream-large", sampleRate: 16000, frameMs: 200 });

    await expect(provider.pushChunk({
      sessionId: "stream-large",
      sequence: 0,
      sampleRate: 16000,
      pcm: Buffer.alloc(15 * 1024 * 1024),
    })).rejects.toThrow("too large");
  });
});
