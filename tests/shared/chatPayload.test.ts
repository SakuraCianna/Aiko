import { describe, expect, it } from "vitest";
import { MAX_IMAGE_BYTES, validateChatPayload } from "../../src/shared/chatPayload";

describe("validateChatPayload", () => {
  it("accepts text with image and audio attachments", () => {
    const payload = validateChatPayload({
      text: "看看这张图,再听一下这个声音.",
      attachments: [
        {
          id: "image-1",
          kind: "image",
          name: "sample.png",
          mimeType: "image/png",
          size: 3,
          dataUrl: "data:image/png;base64,AAAA"
        },
        {
          id: "audio-1",
          kind: "audio",
          name: "voice.webm",
          mimeType: "audio/webm",
          size: 3,
          dataUrl: "data:audio/webm;base64,AAAA"
        }
      ]
    });

    expect(payload.text).toBe("看看这张图,再听一下这个声音.");
    expect(payload.attachments).toHaveLength(2);
  });

  it("rejects unsupported attachment MIME types", () => {
    expect(() =>
      validateChatPayload({
        text: "",
        attachments: [
          {
            id: "bad-1",
            kind: "image",
            name: "bad.svg",
            mimeType: "image/svg+xml",
            size: 12,
            dataUrl: "data:image/svg+xml;base64,AAAA"
          }
        ]
      })
    ).toThrow();
  });

  it("rejects oversized image attachments", () => {
    expect(() =>
      validateChatPayload({
        text: "",
        attachments: [
          {
            id: "huge-1",
            kind: "image",
            name: "huge.png",
            mimeType: "image/png",
            size: MAX_IMAGE_BYTES + 1,
            dataUrl: "data:image/png;base64,AAAA"
          }
        ]
      })
    ).toThrow();
  });

  it("rejects attachments whose declared size does not match base64 content", () => {
    expect(() =>
      validateChatPayload({
        text: "",
        attachments: [
          {
            id: "spoofed-1",
            kind: "image",
            name: "spoofed.png",
            mimeType: "image/png",
            size: 1,
            dataUrl: "data:image/png;base64,AAAA"
          }
        ]
      })
    ).toThrow();
  });
});
