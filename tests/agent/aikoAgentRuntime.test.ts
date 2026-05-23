import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  AIKO_CHAT_TEMPERATURE,
  createAikoAgentRuntime,
  extractAssistantText,
  isConversationResetRequest
} from "../../src/main/agent/aikoAgentRuntime";
import { createAikoTraceRecorder } from "../../src/main/agent/trace/aikoTrace";
import { buildAikoSystemPrompt, loadAikoPersonaPrompt } from "../../src/main/ai/prompts";
import type { ChatPayload } from "../../src/shared/chatPayload";

describe("Aiko persona prompt", () => {
  it("loads the persona prompt from 人物设定.md", () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "aiko-persona-"));
    fs.writeFileSync(path.join(rootDir, "人物设定.md"), "# Aiko\n\n她是安静但敏锐的桌面伙伴.", "utf8");

    expect(loadAikoPersonaPrompt(rootDir)).toContain("安静但敏锐");
  });

  it("builds a system prompt with persona and safety boundaries", () => {
    const prompt = buildAikoSystemPrompt("Aiko 是有一点俏皮但不过度打扰用户的桌宠.");

    expect(prompt).toContain("有一点俏皮");
    expect(prompt).toContain("不要教用户手动操作步骤");
    expect(prompt).toContain("不能直接执行系统操作");
    expect(prompt).toContain("待确认动作");
  });

  it("adds anti-hallucination rules without removing Aiko's personality", () => {
    const prompt = buildAikoSystemPrompt("Aiko 说话温和,敏锐,偶尔有一点轻松的俏皮感.");

    expect(prompt).toContain("事实来源优先级");
    expect(prompt).toContain("没有可靠来源时");
    expect(prompt).toContain("不要编造");
    expect(prompt).toContain("不要为了显得安全而变成冷冰冰的客服腔");
    expect(prompt).toContain("温和,敏锐");
  });
});

describe("createAikoAgentRuntime", () => {
  it("keeps the default chat model temperature low enough for a local assistant", () => {
    expect(AIKO_CHAT_TEMPERATURE).toBeLessThanOrEqual(0.3);
  });

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
      title: "打开应用:VS Code",
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
              { role: "assistant", content: "先处理最重要的一项,再安排复习和休息." }
            ]
          };
        }
      }
    });

    const response = await runtime.respond(textPayload("帮我规划今晚的学习安排"));

    expect(response).toEqual({ message: "先处理最重要的一项,再安排复习和休息." });
  });

  it("records retriever and planner lifecycle events for each request", async () => {
    const traceRecorder = createAikoTraceRecorder();
    const runtime = createAikoAgentRuntime({
      traceRecorder,
      agent: {
        async invoke() {
          return {
            messages: [{ role: "assistant", content: "先这样安排." }]
          };
        }
      }
    });

    await runtime.respond(textPayload("帮我规划今晚的学习安排"));

    expect(traceRecorder.list()[0]?.events.map((event) => event.name)).toEqual([
      "retriever.completed",
      "planner.completed",
      "agent.completed",
      "request.completed"
    ]);
  });

  it("keeps model-proposed actions isolated across concurrent requests", async () => {
    const firstGate = createGate();
    const secondGate = createGate();
    let factoryCalls = 0;
    const runtime = createAikoAgentRuntime({
      agentFactory(actions) {
        factoryCalls += 1;
        const requestIndex = factoryCalls;
        return {
          async invoke() {
            if (requestIndex === 1) {
              await firstGate.promise;
              actions.push(modelAction("应用 A"));
              return { messages: [{ role: "assistant", content: "准备打开应用 A." }] };
            }

            actions.push(modelAction("应用 B"));
            secondGate.release();
            return { messages: [{ role: "assistant", content: "准备打开应用 B." }] };
          }
        };
      }
    });

    const firstResponse = runtime.respond(textPayload("请帮我处理应用 A"));
    const secondResponse = runtime.respond(textPayload("请帮我处理应用 B"));
    await secondGate.promise;
    firstGate.release();

    await expect(firstResponse).resolves.toMatchObject({
      pendingAction: {
        target: "应用 A"
      }
    });
    await expect(secondResponse).resolves.toMatchObject({
      pendingAction: {
        target: "应用 B"
      }
    });
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
            messages: [{ role: "assistant", content: "那就安排轻量一点." }]
          };
        }
      }
    });

    const response = await runtime.respond({
      text: "帮我安排一下",
      attachments: [audioAttachment()]
    });

    expect(response.message).toBe("那就安排轻量一点.");
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
            messages: [{ role: "assistant", content: "那我会先安排轻量复习." }]
          };
        }
      }
    });

    const response = await runtime.respond(textPayload("帮我安排今晚学习"));

    expect(response.message).toBe("那我会先安排轻量复习.");
    expect(invokeInput).toContain("长期记忆");
    expect(invokeInput).toContain("只作为偏好参考");
    expect(invokeInput).toContain("当前输入优先");
    expect(invokeInput).toContain("用户喜欢晚上学习时先做轻量复习");
  });

  it("injects current conversation history into the next LangChain request", async () => {
    const invokeInputs: string[] = [];
    const runtime = createAikoAgentRuntime({
      agent: {
        async invoke(input) {
          invokeInputs.push(JSON.stringify(input));
          return {
            messages: [{ role: "assistant", content: invokeInputs.length === 1 ? "可以, 我先记在当前对话里." : "我会沿着刚才的安排继续." }]
          };
        }
      }
    });

    await runtime.respond(textPayload("今晚我想先复习英语"));
    await runtime.respond(textPayload("那第二步呢"));

    expect(invokeInputs[1]).toContain("当前对话上下文");
    expect(invokeInputs[1]).toContain("用户:今晚我想先复习英语");
    expect(invokeInputs[1]).toContain("Aiko:可以, 我先记在当前对话里.");
  });

  it("resets short-term conversation context without deleting long-term memory", async () => {
    let recallCount = 0;
    let invokeCount = 0;
    const runtime = createAikoAgentRuntime({
      memoryRuntime: {
        async recall() {
          recallCount += 1;
          return [];
        },
        async rememberCandidate() {
          return;
        }
      },
      agent: {
        async invoke() {
          invokeCount += 1;
          return {
            messages: [{ role: "assistant", content: "这一轮应该不会调用模型." }]
          };
        }
      }
    });

    await runtime.respond(textPayload("今晚我想先复习英语"));
    expect(runtime.listConversation().messages.length).toBeGreaterThan(0);

    const response = await runtime.respond(textPayload("开启新对话"));

    expect(response.message).toContain("当前对话上下文已清空");
    expect(response.message).toContain("长期记忆仍然保留");
    expect(runtime.listConversation().messages).toEqual([]);
    expect(invokeCount).toBe(1);
    expect(recallCount).toBe(1);
  });

  it("detects natural requests to start a fresh conversation", () => {
    const resetPhrases = [
      "我们开始一段新的聊天吧",
      "重新开始聊吧",
      "换个新话题",
      "这段先到这里, 我们开个新的对话",
      "从头开始吧",
      "忘掉刚才的聊天"
    ];

    for (const phrase of resetPhrases) {
      expect(isConversationResetRequest(textPayload(phrase))).toBe(true);
    }

    expect(isConversationResetRequest(textPayload("帮我总结刚才的聊天"))).toBe(false);
    expect(isConversationResetRequest(textPayload("重新开始这个计划"))).toBe(false);
    expect(isConversationResetRequest({ text: "我们开始一段新的聊天吧", attachments: [audioAttachment()] })).toBe(false);
  });

  it("tells the model not to infer speech content when speech understanding fails", async () => {
    let invokeInput = "";
    const runtime = createAikoAgentRuntime({
      agent: {
        async invoke(input) {
          invokeInput = JSON.stringify(input);
          return {
            messages: [{ role: "assistant", content: "我现在还不能可靠理解这段语音." }]
          };
        }
      }
    });

    await runtime.respond({
      text: "",
      attachments: [audioAttachment()]
    });

    expect(invokeInput).toContain("语音理解");
    expect(invokeInput).toContain("不要假装已经理解语音内容");
    expect(invokeInput).toContain("provider 尚未配置");
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
            messages: [{ role: "assistant", content: "我记住这个偏好了." }]
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
            messages: [{ role: "assistant", content: "先这样安排." }]
          };
        }
      }
    });

    await expect(runtime.respond(textPayload("帮我安排今晚学习"))).resolves.toEqual({
      message: "先这样安排."
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
            messages: [{ role: "assistant", content: "我先记在当前对话里." }]
          };
        }
      }
    });

    await expect(runtime.respond(textPayload("以后叫我 Sakura"))).resolves.toEqual({
      message: "我先记在当前对话里."
    });
  });

  it("deduplicates extracted memory candidates before storing", async () => {
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
            messages: [{ role: "assistant", content: "我会这样称呼你." }]
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

    expect(response.message).toContain("大模型那边现在没接上");
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
          yield { messages: [{ role: "assistant", content: "好的,我来安排." }] };
        }
      }
    });

    const response = await runtime.respondStream(textPayload("帮我安排今天"), (delta) => deltas.push(delta));

    expect(response).toEqual({ message: "好的,我来安排." });
    expect(deltas).toEqual(["好的", ",我来安排."]);
  });

  it("turns long-form planning requests into a desktop markdown action without streaming the full draft", async () => {
    const deltas: string[] = [];
    const markdown = "# 学习规划\n\n## 目标\n\n把今天的任务拆成三段, 每段都有明确产出.";
    const runtime = createAikoAgentRuntime({
      agent: {
        async invoke() {
          return {
            messages: [{ role: "assistant", content: markdown }]
          };
        },
        async *stream() {
          throw new Error("long-form markdown requests should be buffered before confirmation");
        }
      }
    });

    const response = await runtime.respondStream(textPayload("帮我生成一份具体学习规划"), (delta) => deltas.push(delta));

    expect(deltas).toEqual([]);
    expect(response.message).toContain("Markdown");
    expect(response.pendingAction).toMatchObject({
      title: "写入 Aiko回答.md",
      risk: "medium",
      capability: "write_desktop_markdown",
      target: "Desktop/Aiko",
      params: {
        title: "Aiko回答",
        content: markdown
      }
    });
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

function modelAction(target: string) {
  return {
    title: `打开应用:${target}`,
    source: target,
    risk: "low" as const,
    capability: "open_application",
    target
  };
}

function createGate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    promise,
    release
  };
}
