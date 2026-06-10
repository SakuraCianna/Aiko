import { describe, expect, test } from "vitest";
import {
  buildGlmModelRoute,
  extractAssistantText,
  isConversationResetRequest,
  isRetryableModelRouteError,
  shouldPreferDesktopMarkdownResponse
} from "./aikoAgentRuntime";

describe("Aiko agent runtime helpers", () => {
  test("deduplicates model routes while preserving priority", () => {
    expect(buildGlmModelRoute("glm-4.6v-flash", ["glm-4v-flash", "glm-4.6v-flash", "  glm-air  "])).toEqual([
      "glm-4.6v-flash",
      "glm-4v-flash",
      "glm-air"
    ]);
  });

  test("treats transient network failures as retryable model route errors", () => {
    expect(isRetryableModelRouteError(new Error("fetch failed"))).toBe(true);
    expect(isRetryableModelRouteError({ code: "ECONNRESET" })).toBe(true);
  });

  test("does not retry validation-style model errors", () => {
    expect(isRetryableModelRouteError({ status: 400, message: "invalid request" })).toBe(false);
  });

  test("removes model-written roleplay continuations from assistant text", () => {
    const result = {
      messages: [
        {
          role: "assistant",
          content: "Aiko: 我先给你一个稳一点的版本。\n用户: 那下一步呢?"
        }
      ]
    };

    expect(extractAssistantText(result)).toBe("我先给你一个稳一点的版本。");
  });

  test("does not reset the conversation for requests that ask to summarize current context", () => {
    expect(isConversationResetRequest({ text: "帮我总结一下刚才的聊天", attachments: [] })).toBe(false);
    expect(isConversationResetRequest({ text: "开启一个新对话", attachments: [] })).toBe(true);
  });

  test("prefers desktop Markdown for detailed document-like responses", () => {
    expect(shouldPreferDesktopMarkdownResponse("帮我整理一份完整的项目总结")).toBe(true);
    expect(shouldPreferDesktopMarkdownResponse("你好")).toBe(false);
  });
});
