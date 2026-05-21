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

  it("injects recalled long-term memories into the LangChain agent context", async () => {
    let invokeInput = "";
    const runtime = createAikoAgentRuntime({
      memoryRuntime: {
        async recall() {
          return [
            {
              id: "memory_1",
              type: "preference",
              content: "用户喜欢晚上学习时先做轻量复习"
            }
          ];
        },
        async rememberCandidate() {
          return;
        }
      },
      agent: {
        async invoke(input) {
          invokeInput = JSON.stringify(input);
          return {
            messages: [{ role: "assistant", content: "那我会先安排轻量复习。" }]
          };
        }
      }
    });

    const response = await runtime.respond(textPayload("帮我安排今晚学习"));

    expect(response.message).toBe("那我会先安排轻量复习。");
    expect(invokeInput).toContain("长期记忆");
    expect(invokeInput).toContain("用户喜欢晚上学习时先做轻量复习");
  });

  it("stores accepted memory candidates after an agent response", async () => {
    const stored: string[] = [];
    const runtime = createAikoAgentRuntime({
      memoryRuntime: {
        async recall() {
          return [];
        },
        async rememberCandidate(candidate, status) {
          stored.push(`${status}:${candidate.content}`);
        }
      },
      memoryCandidateExtractor: async () => [
        {
          type: "preference",
          content: "用户喜欢被称呼为 Sakura",
          confidence: 0.91,
          requiresConfirmation: false
        }
      ],
      agent: {
        async invoke() {
          return {
            messages: [{ role: "assistant", content: "我记住这个偏好了。" }]
          };
        }
      }
    });

    await runtime.respond(textPayload("以后叫我 Sakura"));

    expect(stored).toEqual(["accepted:用户喜欢被称呼为 Sakura"]);
  });

  it("keeps the agent response when memory recall fails", async () => {
    const runtime = createAikoAgentRuntime({
      memoryRuntime: {
        async recall() {
          throw new Error("memory database unavailable");
        },
        async rememberCandidate() {
          return;
        }
      },
      agent: {
        async invoke() {
          return {
            messages: [{ role: "assistant", content: "先这样安排。" }]
          };
        }
      }
    });

    await expect(runtime.respond(textPayload("帮我安排今晚学习"))).resolves.toEqual({
      message: "先这样安排。"
    });
  });

  it("keeps the agent response when memory extraction fails", async () => {
    const runtime = createAikoAgentRuntime({
      memoryRuntime: {
        async recall() {
          return [];
        },
        async rememberCandidate() {
          throw new Error("memory write should not run");
        }
      },
      memoryCandidateExtractor: async () => {
        throw new Error("invalid memory JSON");
      },
      agent: {
        async invoke() {
          return {
            messages: [{ role: "assistant", content: "我先记在当前对话里。" }]
          };
        }
      }
    });

    await expect(runtime.respond(textPayload("以后叫我 Sakura"))).resolves.toEqual({
      message: "我先记在当前对话里。"
    });
  });

  it("can use repository-level memory dedupe across repeated agent responses", async () => {
    const stored = new Map<string, number>();
    const runtime = createAikoAgentRuntime({
      memoryRuntime: {
        async recall() {
          return [];
        },
        async rememberCandidate(candidate, status) {
          const key = `${status}:${candidate.type}:${candidate.content.trim().toLowerCase()}`;
          stored.set(key, Math.max(stored.get(key) ?? 0, candidate.confidence));
        }
      },
      memoryCandidateExtractor: async () => [
        {
          type: "preference",
          content: " 用户喜欢被称呼为 Sakura ",
          confidence: 0.7,
          requiresConfirmation: false
        },
        {
          type: "preference",
          content: "用户喜欢被称呼为 Sakura",
          confidence: 0.95,
          requiresConfirmation: false
        }
      ],
      agent: {
        async invoke() {
          return {
            messages: [{ role: "assistant", content: "我会这样称呼你。" }]
          };
        }
      }
    });

    await runtime.respond(textPayload("以后叫我 Sakura"));

    expect([...stored.entries()]).toEqual([["accepted:preference:用户喜欢被称呼为 sakura", 0.95]]);
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
  it("streams assistant deltas when the injected LangChain agent supports streaming", async () => {
    const deltas: string[] = [];
    const runtime = createAikoAgentRuntime({
      agent: {
        async invoke() {
          throw new Error("stream should be used");
        },
        async *stream() {
          yield { messages: [{ role: "assistant", content: "好的" }] };
          yield { messages: [{ role: "assistant", content: "好的，我来安排。" }] };
        }
      }
    });

    const response = await runtime.respondStream(textPayload("帮我安排今天"), (delta) => deltas.push(delta));

    expect(response).toEqual({ message: "好的，我来安排。" });
    expect(deltas).toEqual(["好的", "，我来安排。"]);
  });

  it("proposes deterministic web search actions", async () => {
    const runtime = createAikoAgentRuntime({
      agent: {
        async invoke() {
          return { messages: [] };
        }
      }
    });

    const response = await runtime.respond(textPayload("搜索 LangChain TypeScript agent"));

    expect(response.pendingAction).toMatchObject({
      capability: "open_url",
      target: "https://www.bing.com/search?q=LangChain%20TypeScript%20agent"
    });
  });

  it("supports hour-based deterministic reminders", async () => {
    const runtime = createAikoAgentRuntime({
      agent: {
        async invoke() {
          return { messages: [] };
        }
      }
    });

    const response = await runtime.respond(textPayload("2 小时后提醒我喝水"));

    expect(response.pendingAction).toMatchObject({
      capability: "create_reminder",
      params: {
        amount: 2,
        unit: "hours",
        title: "喝水"
      }
    });
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
