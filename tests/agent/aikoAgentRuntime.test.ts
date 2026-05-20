import { describe, expect, it } from "vitest";
import { createAikoAgentRuntime, extractAssistantText } from "../../src/main/agent/aikoAgentRuntime";
import type { ChatPayload } from "../../src/shared/chatPayload";

describe("createAikoAgentRuntime", () => {
  it("proposes low-risk application actions without calling the model", async () => {
    let invoked = false;
    const runtime = createAikoAgentRuntime({
      agent: {
        async invoke() {
          invoked = true;
          return { messages: [] };
        }
      }
    });

    const response = await runtime.respond(textPayload("打开 VS Code"));

    expect(invoked).toBe(false);
    expect(response.pendingAction).toEqual({
      title: "打开应用：VS Code",
      source: "打开 VS Code",
      risk: "low",
      capability: "open_application",
      target: "VS Code"
    });
  });

  it("routes contextual chat through the LangChain agent", async () => {
    const runtime = createAikoAgentRuntime({
      agent: {
        async invoke() {
          return {
            messages: [
              { role: "user", content: "帮我规划今晚的学习安排" },
              { role: "assistant", content: "先处理最重要的一项，再安排复习和休息。" }
            ]
          };
        }
      }
    });

    const response = await runtime.respond(textPayload("帮我规划今晚的学习安排"));

    expect(response).toEqual({ message: "先处理最重要的一项，再安排复习和休息。" });
  });

  it("uses speech understanding transcripts for deterministic local actions", async () => {
    let invoked = false;
    const runtime = createAikoAgentRuntime({
      speechUnderstandingProvider: {
        async understand() {
          return [
            {
              attachmentId: "audio-1",
              transcript: "打开 VS Code",
              confidence: 0.92,
              language: "zh-CN"
            }
          ];
        }
      },
      agent: {
        async invoke() {
          invoked = true;
          return { messages: [] };
        }
      }
    });

    const response = await runtime.respond({
      text: "",
      attachments: [audioAttachment()]
    });

    expect(invoked).toBe(false);
    expect(response.pendingAction?.capability).toBe("open_application");
    expect(response.pendingAction?.target).toBe("VS Code");
  });

  it("adds speech understanding context before invoking the LangChain agent", async () => {
    let invokeInput = "";
    const runtime = createAikoAgentRuntime({
      speechUnderstandingProvider: {
        async understand() {
          return [
            {
              attachmentId: "audio-1",
              transcript: "我今天想轻松一点安排学习",
              confidence: 0.88,
              language: "zh-CN"
            }
          ];
        }
      },
      agent: {
        async invoke(input) {
          invokeInput = JSON.stringify(input);
          return {
            messages: [{ role: "assistant", content: "那就安排轻一点。" }]
          };
        }
      }
    });

    const response = await runtime.respond({
      text: "帮我安排一下",
      attachments: [audioAttachment()]
    });

    expect(response.message).toBe("那就安排轻一点。");
    expect(invokeInput).toContain("语音理解");
    expect(invokeInput).toContain("我今天想轻松一点安排学习");
  });

  it("returns a visible fallback when the agent call fails", async () => {
    const runtime = createAikoAgentRuntime({
      agent: {
        async invoke() {
          throw new Error("network unavailable");
        }
      }
    });

    const response = await runtime.respond(textPayload("随便聊聊"));

    expect(response.message).toContain("我现在连不上大模型");
  });
});

describe("extractAssistantText", () => {
  it("reads the last assistant text from LangChain message arrays", () => {
    expect(
      extractAssistantText({
        messages: [
          { role: "assistant", content: "旧回复" },
          {
            role: "assistant",
            content: [
              { type: "text", text: "新回复" },
              { type: "image_url", image_url: { url: "data:image/png;base64,abc" } }
            ]
          }
        ]
      })
    ).toBe("新回复");
  });
});

function textPayload(text: string): ChatPayload {
  return {
    text,
    attachments: []
  };
}

function audioAttachment(): ChatPayload["attachments"][number] {
  return {
    id: "audio-1",
    kind: "audio",
    name: "voice.webm",
    mimeType: "audio/webm",
    size: 8,
    dataUrl: "data:audio/webm;base64,AAAA"
  };
}
