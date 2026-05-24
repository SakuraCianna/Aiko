import { describe, expect, it } from "vitest";
import { createAikoResearchAgent } from "../../src/main/agent/subagents/researchAgent";

describe("createAikoResearchAgent", () => {
  it("retrieves web research and current knowledge through one subagent boundary", async () => {
    const researchAgent = createAikoResearchAgent({
      webRetriever: {
        async retrieve(input) {
          return {
            query: input.userText,
            provider: "tavily-mcp",
            createdAt: "2026-05-24T00:00:00.000Z",
            results: [
              {
                title: "LangGraph supervisor",
                url: "https://langchain-ai.github.io/langgraphjs/reference/modules/langgraph-supervisor.html",
                snippet: "Create a multi-agent supervisor.",
                source: "tavily-mcp"
              }
            ]
          };
        }
      },
      currentKnowledgeProvider: {
        async retrieve(input) {
          return {
            kind: "weather",
            title: "Shanghai weather",
            query: input.userTranscript,
            source: "Open-Meteo",
            sourceUrl: "https://open-meteo.com/en/docs",
            createdAt: "2026-05-24T00:00:00.000Z",
            summary: "Cloudy, 24 C.",
            facts: [{ label: "temperature", value: "24 C" }],
            links: []
          };
        }
      }
    });

    const result = await researchAgent.retrieve({
      userText: "search LangGraph supervisor",
      userTranscript: "Shanghai weather"
    });

    expect(result.webResearch).toMatchObject({
      provider: "tavily-mcp",
      query: "search LangGraph supervisor"
    });
    expect(result.currentKnowledge).toMatchObject({
      kind: "weather",
      source: "Open-Meteo",
      summary: "Cloudy, 24 C."
    });
  });

  it("degrades failed web research without blocking current knowledge", async () => {
    const researchAgent = createAikoResearchAgent({
      webRetriever: {
        async retrieve() {
          throw new Error("network down");
        }
      },
      currentKnowledgeProvider: {
        async retrieve() {
          return {
            kind: "weather",
            title: "Tokyo weather",
            query: "Tokyo",
            source: "Open-Meteo",
            sourceUrl: "https://open-meteo.com/en/docs",
            createdAt: "2026-05-24T00:00:00.000Z",
            summary: "Sunny, 25 C.",
            facts: [],
            links: []
          };
        }
      }
    });

    const result = await researchAgent.retrieve({
      userText: "search latest news",
      userTranscript: "Tokyo weather"
    });

    expect(result.webResearch).toBeNull();
    expect(result.currentKnowledge?.summary).toBe("Sunny, 25 C.");
  });

  it("returns empty research context when providers are not configured", async () => {
    const researchAgent = createAikoResearchAgent();

    await expect(
      researchAgent.retrieve({
        userText: "hello",
        userTranscript: "hello"
      })
    ).resolves.toEqual({
      webResearch: null,
      currentKnowledge: null
    });
  });
});
