import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sourceFiles = [
  "src/main/index.ts",
  "src/main/ipc/handlers.ts",
  "src/main/agent/aikoAgentRuntime.ts"
];

describe("Aiko agent architecture boundary", () => {
  it("keeps LangChain as the only agent orchestration path", () => {
    const source = sourceFiles.map((file) => readFileSync(file, "utf8")).join("\n");

    expect(source).toContain("createAikoAgentRuntime");
    expect(source).toContain("createAgent");
    expect(source).toContain("createAikoAgentWorkflow");
    expect(source).not.toContain("createGlmClient");
    expect(source).not.toContain("routeIntent");
  });

  it("keeps explicit LangGraph orchestration inside the agent graph boundary", () => {
    const graphWorkflow = readFileSync("src/main/agent/graph/aikoAgentWorkflow.ts", "utf8");

    expect(graphWorkflow).toContain("@langchain/langgraph");
    expect(graphWorkflow).toContain("entrypoint");
    expect(graphWorkflow).toContain("task");
  });

  it("keeps research and memory concerns behind subagent boundaries", () => {
    const researchAgentPath = join("src", "main", "agent", "subagents", "researchAgent.ts");
    const memoryAgentPath = join("src", "main", "agent", "subagents", "memoryAgent.ts");
    const retriever = readFileSync("src/main/agent/retriever/aikoRetriever.ts", "utf8");
    const runtime = readFileSync("src/main/agent/aikoAgentRuntime.ts", "utf8");

    expect(existsSync(researchAgentPath)).toBe(true);
    expect(existsSync(memoryAgentPath)).toBe(true);
    expect(retriever).toContain("createAikoResearchAgent");
    expect(retriever).toContain("createAikoMemoryAgent");
    expect(runtime).toContain("createAikoMemoryAgent");
    expect(runtime).not.toContain("classifyMemoryCandidate");
  });

  it("keeps LangChain provider imports inside the agent runtime boundary", () => {
    const mainEntry = readFileSync("src/main/index.ts", "utf8");
    const ipcHandlers = readFileSync("src/main/ipc/handlers.ts", "utf8");
    const runtime = readFileSync("src/main/agent/aikoAgentRuntime.ts", "utf8");

    expect(runtime).toContain("from \"langchain\"");
    expect(runtime).toContain("from \"@langchain/openai\"");
    expect(mainEntry).not.toContain("@langchain");
    expect(ipcHandlers).not.toContain("@langchain");
    expect(ipcHandlers).not.toContain("from \"langchain\"");
  });

  it("expires pending local actions before execution", () => {
    const ipcHandlers = readFileSync("src/main/ipc/handlers.ts", "utf8");

    expect(ipcHandlers).toContain("PENDING_ACTION_TTL_MS");
    expect(ipcHandlers).toContain("removeExpiredPendingActions");
    expect(ipcHandlers).toContain("createdAt");
  });

  it("clears pending local actions when the current conversation is reset", () => {
    const ipcHandlers = readFileSync("src/main/ipc/handlers.ts", "utf8");

    expect(ipcHandlers).toContain("isConversationResetRequest");
    expect(ipcHandlers).toContain("conversation:reset");
    expect(ipcHandlers).toContain("pendingActions.clear()");
  });

  it("aborts an older stream before replacing the same request id", () => {
    const ipcHandlers = readFileSync("src/main/ipc/handlers.ts", "utf8");

    expect(ipcHandlers).toContain("abortPreviousStreamController(requestId)");
    expect(ipcHandlers).toContain("previousController.abort()");
  });

  it("does not auto-execute unremembered open-application actions from the agent", () => {
    const ipcHandlers = readFileSync("src/main/ipc/handlers.ts", "utf8");

    expect(ipcHandlers).toContain("if (actionExecutor.isRememberedAction(decision.action))");
    expect(ipcHandlers).toContain("await executeApprovedAction(decision.action, false)");
    expect(ipcHandlers).toContain("return { message, pendingAction: storePendingAction(decision.action) }");
  });

  it("resumes workflow approval before executing local actions", () => {
    const ipcHandlers = readFileSync("src/main/ipc/handlers.ts", "utf8");

    expect(ipcHandlers).toContain("resumePendingActionApproval(action, { type: \"approve\" })");
    expect(ipcHandlers).toContain("return actionExecutor.execute({ action, remember })");
  });

  it("rejects workflow approval when a pending local action is cancelled", () => {
    const ipcHandlers = readFileSync("src/main/ipc/handlers.ts", "utf8");

    expect(ipcHandlers).toContain("action:cancel");
    expect(ipcHandlers).toContain("resumePendingActionApproval(pendingEntry.action, {");
    expect(ipcHandlers).toContain("type: \"reject\"");
  });

  it("documents that future agent work must extend the LangChain runtime", () => {
    const architectureDoc = join("docs", "agent-architecture.md");

    expect(existsSync(architectureDoc)).toBe(true);

    const doc = readFileSync(architectureDoc, "utf8");
    expect(doc).toContain("LangChain");
    expect(doc).toContain("LangGraph-backed");
    expect(doc).toContain("src/main/agent/aikoAgentRuntime.ts");
    expect(doc).toContain("不要重新引入");
  });
});
