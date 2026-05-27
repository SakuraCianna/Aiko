import { describe, expect, it } from "vitest";
import type { ChatPayload } from "../../src/shared/chatPayload";
import {
  selectActionResultCue,
  selectCancelMotion,
  selectIdleAmbientMotion,
  selectInitialCharacterCue,
  selectInterruptionCue,
  selectWaitingCue,
  selectSpeechMotion
} from "../../src/renderer/character/motionCues";

describe("motion cues", () => {
  it("maps live search requests to a searching body cue", () => {
    expect(selectInitialCharacterCue(textPayload("今天的新闻是什么"))).toEqual({
      behavior: "searching",
      motion: "search"
    });
  });

  it("maps long document requests to a writing body cue", () => {
    expect(selectInitialCharacterCue(textPayload("帮我制定一份完整的学习计划"))).toEqual({
      behavior: "writing",
      motion: "write"
    });
  });

  it("maps questions and audio input to curious listening cues", () => {
    expect(selectInitialCharacterCue(textPayload("这个 MCP 是什么?"))).toEqual({
      behavior: "curious",
      motion: "curious"
    });
    expect(
      selectInitialCharacterCue({
        text: "",
        attachments: [
          {
            id: "audio-1",
            kind: "audio",
            name: "voice.webm",
            mimeType: "audio/webm",
            size: 1,
            dataUrl: "data:audio/webm;base64,AA=="
          }
        ]
      })
    ).toEqual({
      behavior: "listening",
      motion: "curious"
    });
  });

  it("selects presenting, explaining and emphasis motions from reply text", () => {
    expect(selectSpeechMotion("下面是方案步骤:\n1. 先做检索\n2. 再做执行")).toBe("present");
    expect(selectSpeechMotion("这是一段比较长的解释, 用来说明 Aiko 在长回答时应该切换到更像讲解的手势.".repeat(3))).toBe(
      "explain"
    );
    expect(selectSpeechMotion("当然可以, 已经完成!")).toBe("emphasis");
  });

  it("selects distinct action result and cancellation motions", () => {
    expect(selectActionResultCue(true)).toEqual({
      behavior: "success",
      motion: "proud"
    });
    expect(selectActionResultCue(false)).toEqual({
      behavior: "recovering",
      motion: "errorRecover"
    });
    expect(selectCancelMotion(true)).toBe("interrupt");
    expect(selectCancelMotion(false)).toBe("deny");
  });

  it("selects ambient, waiting and interruption cues for desktop-pet presence", () => {
    expect(selectIdleAmbientMotion(0)).toBe("idleShift");
    expect(selectIdleAmbientMotion(1)).toBe("settle");
    expect(selectWaitingCue(5)).toEqual({
      behavior: "waiting",
      motion: "wait"
    });
    expect(selectWaitingCue(45)).toEqual({
      behavior: "waiting",
      motion: "focus"
    });
    expect(selectInterruptionCue("cancelled")).toEqual({
      behavior: "idle",
      motion: "interrupt"
    });
    expect(selectInterruptionCue("replaced")).toEqual({
      behavior: "recovering",
      motion: "errorRecover"
    });
  });
});

function textPayload(text: string): ChatPayload {
  return {
    text,
    attachments: []
  };
}
