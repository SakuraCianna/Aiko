import { describe, expect, it } from "vitest";
import { createAikoRetriever } from "../../src/main/agent/retriever/aikoRetriever";
import type { ChatPayload } from "../../src/shared/chatPayload";

describe("createAikoRetriever", () => {
  it("recalls memories and formats model content with grounding rules", async () => {
    const retriever = createAikoRetriever({
      memoryRuntime: {
        async recall() {
          return [
            {
              id: "memory_1",
              type: "preference",
              content: "用户喜欢晚上先做轻量复习"
            }
          ];
        },
        async rememberCandidate() {
          return;
        }
      }
    });

    const context = await retriever.retrieve(textPayload("帮我安排今晚学习"));

    expect(context.userTranscript).toBe("帮我安排今晚学习");
    expect(JSON.stringify(context.userContent)).toContain("长期记忆");
    expect(JSON.stringify(context.userContent)).toContain("只作为偏好参考");
    expect(JSON.stringify(context.userContent)).toContain("用户喜欢晚上先做轻量复习");
  });

  it("keeps audio failures explicit when ASR is not configured", async () => {
    const retriever = createAikoRetriever({});

    const context = await retriever.retrieve({
      text: "",
      attachments: [
        {
          id: "audio-1",
          kind: "audio",
          name: "voice.webm",
          mimeType: "audio/webm",
          size: 8,
          dataUrl: "data:audio/webm;base64,AAAA"
        }
      ]
    });

    expect(JSON.stringify(context.userContent)).toContain("语音理解");
    expect(JSON.stringify(context.userContent)).toContain("不要假装已经理解语音内容");
    expect(JSON.stringify(context.userContent)).toContain("provider 尚未配置");
  });

  it("provides tool hints from the registry", async () => {
    const retriever = createAikoRetriever({});

    const context = await retriever.retrieve(textPayload("随便聊聊"));

    expect(context.toolHints).toEqual([
      expect.objectContaining({
        name: "open_application",
        capability: "open_application",
        risk: "low",
        requiresConfirmation: true
      }),
      expect.objectContaining({
        name: "open_url"
      }),
      expect.objectContaining({
        name: "web_search"
      }),
      expect.objectContaining({
        name: "create_reminder"
      }),
      expect.objectContaining({
        name: "recall_memory"
      }),
      expect.objectContaining({
        name: "list_reminders"
      })
    ]);
  });
});

function textPayload(text: string): ChatPayload {
  return {
    text,
    attachments: []
  };
}
