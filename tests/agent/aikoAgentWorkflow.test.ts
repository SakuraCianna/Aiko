import { describe, expect, it } from "vitest";
import { MemorySaver } from "@langchain/langgraph";
import {
  createAikoActionExecutionWorkflow,
  createAikoAgentWorkflow,
  createAikoModelResponseWorkflow,
  isAikoAgentWorkflowInterrupted
} from "../../src/main/agent/graph/aikoAgentWorkflow";
import type { PendingActionDto } from "../../src/shared/ipcTypes";

describe("createAikoAgentWorkflow", () => {
  it("runs the graph lifecycle nodes in order", async () => {
    const calls: string[] = [];
    const workflow = createAikoAgentWorkflow({
      async retrieve(payload) {
        calls.push(`retrieve:${payload.text}`);
        return {
          userText: payload.text,
          userTranscript: payload.text,
          userContent: payload.text,
          attachmentSummaries: [],
          memories: [],
          speechResults: [],
          webResearch: null,
          currentKnowledge: null,
          toolHints: []
        };
      },
      async plan(context) {
        calls.push(`plan:${context.userTranscript}`);
        return {
          mode: "chat",
          replyDraft: "",
          steps: [],
          grounding: []
        };
      },
      async prepare(plan) {
        calls.push(`prepare:${plan.mode}`);
        return {
          kind: "none",
          message: ""
        };
      }
    });

    const result = await workflow.invoke({ text: "帮我安排今晚学习", attachments: [] });

    expect(isAikoAgentWorkflowInterrupted(result)).toBe(false);
    if (isAikoAgentWorkflowInterrupted(result)) throw new Error("workflow should not interrupt");
    expect(calls).toEqual(["retrieve:帮我安排今晚学习", "plan:帮我安排今晚学习", "prepare:chat"]);
    expect(result.stepNames).toEqual(["retrieve", "plan", "prepare", "review"]);
    expect(result.context.userTranscript).toBe("帮我安排今晚学习");
    expect(result.plan.mode).toBe("chat");
    expect(result.proposal.kind).toBe("none");
    expect(result.approval.status).toBe("not_required");
  });

  it("keeps pending actions as passive approval payloads by default", async () => {
    const action = openApplicationAction("VS Code");
    const workflow = createAikoAgentWorkflow({
      async retrieve(payload) {
        return emptyContext(payload.text);
      },
      async plan() {
        return {
          mode: "action",
          replyDraft: "等你确认后我再打开.",
          steps: [{ kind: "action", source: "deterministic", action }],
          grounding: []
        };
      },
      async prepare() {
        return {
          kind: "pending_action",
          message: "等你确认后我再打开.",
          action
        };
      }
    });

    const result = await workflow.invoke({ text: "打开 VS Code", attachments: [] });

    expect(isAikoAgentWorkflowInterrupted(result)).toBe(false);
    if (isAikoAgentWorkflowInterrupted(result)) throw new Error("workflow should not interrupt");
    expect(result.proposal.kind).toBe("pending_action");
    expect(result.approval).toEqual({
      status: "pending_action",
      payload: {
        kind: "pending_action_review",
        message: "等你确认后我再打开.",
        action
      }
    });
  });

  it("can pause pending actions with a LangGraph interrupt and resume with a decision", async () => {
    const action = openApplicationAction("Google Chrome");
    const workflow = createAikoAgentWorkflow({
      approvalMode: "interrupt",
      checkpointer: new MemorySaver(),
      async retrieve(payload) {
        return emptyContext(payload.text);
      },
      async plan() {
        return {
          mode: "action",
          replyDraft: "这个需要你点头.",
          steps: [{ kind: "action", source: "deterministic", action }],
          grounding: []
        };
      },
      async prepare() {
        return {
          kind: "pending_action",
          message: "这个需要你点头.",
          action
        };
      }
    });

    const threadId = "aiko-approval-test";
    const interrupted = await workflow.invoke({ text: "打开浏览器", attachments: [] }, { threadId });

    expect(isAikoAgentWorkflowInterrupted(interrupted)).toBe(true);
    if (!isAikoAgentWorkflowInterrupted(interrupted)) throw new Error("workflow should interrupt");
    expect(interrupted.__interrupt__[0]?.value).toEqual({
      kind: "pending_action_review",
      message: "这个需要你点头.",
      action
    });

    const resumed = await workflow.resume({ type: "approve" }, { threadId });

    expect(isAikoAgentWorkflowInterrupted(resumed)).toBe(false);
    if (isAikoAgentWorkflowInterrupted(resumed)) throw new Error("workflow should resume");
    expect(resumed.approval).toEqual({
      status: "reviewed",
      payload: {
        kind: "pending_action_review",
        message: "这个需要你点头.",
        action
      },
      decision: {
        type: "approve"
      }
    });
  });
});

describe("createAikoModelResponseWorkflow", () => {
  it("runs model generation, postprocessing, and memory commit in order", async () => {
    const calls: string[] = [];
    const workflow = createAikoModelResponseWorkflow<string, { message: string }>({
      async generate() {
        calls.push("model_generate");
        return "raw assistant result";
      },
      async postprocess(raw) {
        calls.push(`postprocess:${raw}`);
        return {
          message: "整理后的回复"
        };
      },
      async commitMemory(outcome) {
        calls.push(`memory_commit:${outcome.message}`);
      }
    });

    const result = await workflow.invoke();

    expect(calls).toEqual([
      "model_generate",
      "postprocess:raw assistant result",
      "memory_commit:整理后的回复"
    ]);
    expect(result).toEqual({
      outcome: {
        message: "整理后的回复"
      },
      stepNames: ["model_generate", "postprocess", "memory_commit"]
    });
  });
});

describe("createAikoActionExecutionWorkflow", () => {
  it("resumes approval before executing the local action", async () => {
    const calls: string[] = [];
    const workflow = createAikoActionExecutionWorkflow({
      async resumeApproval() {
        calls.push("approval_resume");
        return { ok: true, message: "approved" };
      },
      async execute() {
        calls.push("tool_execute");
        return { ok: true, message: "opened" };
      }
    });

    const result = await workflow.invoke();

    expect(calls).toEqual(["approval_resume", "tool_execute"]);
    expect(result).toEqual({
      response: { ok: true, message: "opened" },
      stepNames: ["approval_resume", "tool_execute"]
    });
  });

  it("does not execute the local action when approval resume fails", async () => {
    const calls: string[] = [];
    const workflow = createAikoActionExecutionWorkflow({
      async resumeApproval() {
        calls.push("approval_resume");
        return { ok: false, message: "expired" };
      },
      async execute() {
        calls.push("tool_execute");
        return { ok: true, message: "opened" };
      }
    });

    const result = await workflow.invoke();

    expect(calls).toEqual(["approval_resume"]);
    expect(result).toEqual({
      response: { ok: false, message: "expired" },
      stepNames: ["approval_resume"]
    });
  });
});

function emptyContext(text: string) {
  return {
    userText: text,
    userTranscript: text,
    userContent: text,
    attachmentSummaries: [],
    memories: [],
    speechResults: [],
    webResearch: null,
    currentKnowledge: null,
    toolHints: []
  };
}

function openApplicationAction(target: string): PendingActionDto {
  return {
    title: `打开应用:${target}`,
    source: `打开 ${target}`,
    risk: "low",
    capability: "open_application",
    target
  };
}
