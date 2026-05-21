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
    expect(source).not.toContain("createGlmClient");
    expect(source).not.toContain("routeIntent");
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
