import { describe, expect, it } from "vitest";
import { chunkForSpeech } from "../../src/main/voice/sentenceChunker";

describe("chunkForSpeech", () => {
  it("splits Chinese response into speakable chunks", () => {
    expect(chunkForSpeech("好的，我帮你记下。等到时间我会提醒你。")).toEqual([
      "好的，我帮你记下。",
      "等到时间我会提醒你。"
    ]);
  });

  it("keeps short unfinished text in buffer", () => {
    expect(chunkForSpeech("好的，我")).toEqual([]);
  });
});
