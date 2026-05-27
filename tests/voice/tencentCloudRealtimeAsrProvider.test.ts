import { describe, expect, it, vi } from "vitest";
import { createTencentCloudRealtimeAsrProvider } from "../../src/main/voice/tencentCloudRealtimeAsrProvider";

describe("createTencentCloudRealtimeAsrProvider", () => {
  it("opens Tencent Cloud realtime ASR websocket and emits partial transcripts", async () => {
    const sockets: FakeWebSocket[] = [];
    const provider = createTencentCloudRealtimeAsrProvider(
      {
        enabled: true,
        realtimeEnabled: true,
        appId: "1250000000",
        provider: "tencent-cloud",
        secretId: "akid-test",
        secretKey: "secret-test",
        region: "ap-shanghai",
        engineModelType: "16k_zh",
        voiceFormat: "pcm",
        language: "zh",
        timeoutMs: 30000
      },
      {
        WebSocketCtor: class extends FakeWebSocket {
          constructor(url: string) {
            super(url);
            sockets.push(this);
          }
        } as unknown as typeof WebSocket,
        nowSeconds: () => 1_777_777_777,
        nonce: () => 42,
        voiceId: () => "voice-1"
      }
    );
    const deltas: string[] = [];

    const startPromise = provider.start({
      sessionId: "speech-1",
      sampleRate: 16000,
      frameMs: 200,
      onTranscript: (delta) => deltas.push(`${delta.isFinal}:${delta.text}`)
    });
    sockets[0]?.open();
    await startPromise;

    expect(sockets[0]?.url).toContain("wss://asr.cloud.tencent.com/asr/v2/1250000000?");
    expect(sockets[0]?.url).toContain("secretid=akid-test");
    expect(sockets[0]?.url).toContain("voice_format=1");
    expect(sockets[0]?.url).toContain("engine_model_type=16k_zh");

    await provider.pushChunk({
      sessionId: "speech-1",
      sequence: 0,
      sampleRate: 16000,
      pcm: Buffer.from([1, 2, 3, 4])
    });
    sockets[0]?.message({ code: 0, message: "success", result: { slice_type: 1, voice_text_str: "你好" } });
    sockets[0]?.message({ code: 0, message: "success", result: { slice_type: 2, voice_text_str: "你好 Aiko" } });
    const finishPromise = provider.finish({ sessionId: "speech-1" });
    sockets[0]?.message({ code: 0, message: "success", final: 1, result: { slice_type: 2, voice_text_str: "你好 Aiko" } });
    const result = await finishPromise;

    expect(sockets[0]?.sentBinary).toEqual([Buffer.from([1, 2, 3, 4])]);
    expect(sockets[0]?.sentText.at(-1)).toBe(JSON.stringify({ type: "end" }));
    expect(deltas).toEqual(["false:你好", "true:你好 Aiko", "true:你好 Aiko"]);
    expect(result).toEqual({ transcript: "你好 Aiko", language: "zh" });
  });
});

class FakeWebSocket {
  static readonly OPEN = 1;
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: (() => void) | null = null;
  sentBinary: Buffer[] = [];
  sentText: string[] = [];

  constructor(readonly url: string) {}

  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }

  send(data: string | Buffer) {
    if (typeof data === "string") {
      this.sentText.push(data);
    } else {
      this.sentBinary.push(Buffer.from(data));
    }
  }

  close() {
    this.onclose?.();
  }

  message(payload: unknown) {
    this.onmessage?.({ data: JSON.stringify(payload) } as MessageEvent);
  }
}
