import { describe, expect, it, vi } from "vitest";
import {
  buildTavilyMcpClientConfig,
  createTavilyWebSearchProvider,
  normalizeTavilySearchOutput
} from "../../src/main/agent/mcp/tavilyMcpProvider";
import type { McpClientLike, McpToolLike } from "../../src/main/agent/mcp/mcpToolProvider";
import type { AppConfig } from "../../src/main/config/env";

describe("buildTavilyMcpClientConfig", () => {
  it("builds a stdio MCP client config without putting the API key in args", () => {
    const config = buildTavilyMcpClientConfig(tavilyConfig({ mode: "stdio" }));

    expect(config).toMatchObject({
      onConnectionError: "ignore",
      throwOnLoadError: false,
      useStandardContentBlocks: true,
      defaultToolTimeout: 15000,
      mcpServers: {
        tavily: {
          transport: "stdio",
          command: "npx",
          args: ["-y", "tavily-mcp@0.2.19"],
          env: {
            TAVILY_API_KEY: "tvly-secret"
          },
          stderr: "pipe"
        }
      }
    });
    expect(JSON.stringify(config.mcpServers)).not.toContain("tvly-secret\" ]");
  });

  it("builds a remote MCP client config with a Tavily API key query parameter", () => {
    const config = buildTavilyMcpClientConfig(tavilyConfig({ mode: "remote" }));
    const tavily = config.mcpServers?.tavily;

    expect(tavily).toMatchObject({
      transport: "http",
      automaticSSEFallback: true,
      defaultToolTimeout: 15000
    });
    expect(JSON.stringify(tavily)).toContain("tavilyApiKey=tvly-secret");
  });
});

describe("createTavilyWebSearchProvider", () => {
  it("loads the Tavily MCP search tool lazily and normalizes search results", async () => {
    const invoke = vi.fn(async () => ({
      results: [
        {
          title: "LangChain MCP",
          url: "https://docs.langchain.com/oss/javascript/langchain/mcp",
          content: "Use MultiServerMCPClient to load MCP tools."
        }
      ]
    }));
    const createClient = vi.fn(() => fakeClient([{ name: "tavily-search", invoke }]));
    const provider = createTavilyWebSearchProvider(tavilyConfig(), { createClient });

    const results = await provider.search("LangChain MCP", { maxResults: 2 });

    expect(createClient).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith(
      expect.objectContaining({
        query: "LangChain MCP",
        max_results: 2
      }),
      expect.objectContaining({
        timeout: 15000
      })
    );
    expect(results).toEqual([
      {
        title: "LangChain MCP",
        url: "https://docs.langchain.com/oss/javascript/langchain/mcp",
        snippet: "Use MultiServerMCPClient to load MCP tools.",
        source: "tavily-mcp"
      }
    ]);
  });

  it("rotates to the next Tavily API key when a search call fails", async () => {
    const firstInvoke = vi.fn(async () => {
      throw new Error("429 rate limit");
    });
    const secondInvoke = vi.fn(async () => ({
      results: [
        {
          title: "Fallback key",
          url: "https://example.com/fallback",
          content: "The second key worked."
        }
      ]
    }));
    const close = vi.fn(async () => undefined);
    const createClient = vi
      .fn()
      .mockReturnValueOnce(fakeClient([{ name: "tavily-search", invoke: firstInvoke }], close))
      .mockReturnValueOnce(fakeClient([{ name: "tavily-search", invoke: secondInvoke }]));
    const provider = createTavilyWebSearchProvider(tavilyConfig({ apiKeys: ["tvly-1", "tvly-2"] }), {
      createClient
    });

    const results = await provider.search("LangChain MCP");

    expect(createClient).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(createClient.mock.calls[0]?.[0])).toContain("tvly-1");
    expect(JSON.stringify(createClient.mock.calls[1]?.[0])).toContain("tvly-2");
    expect(close).toHaveBeenCalledTimes(1);
    expect(results).toEqual([
      {
        title: "Fallback key",
        url: "https://example.com/fallback",
        snippet: "The second key worked.",
        source: "tavily-mcp"
      }
    ]);
  });

  it("returns an empty result instead of throwing when the Tavily search tool is unavailable", async () => {
    const provider = createTavilyWebSearchProvider(tavilyConfig(), {
      createClient: () => fakeClient([{ name: "other-tool", invoke: async () => "unused" }])
    });

    await expect(provider.search("anything")).resolves.toEqual([]);
  });

  it("closes the underlying MCP client when the provider is closed", async () => {
    const close = vi.fn(async () => undefined);
    const provider = createTavilyWebSearchProvider(tavilyConfig(), {
      createClient: () => ({
        async getTools() {
          return [{ name: "tavily-search", invoke: async () => ({ results: [] }) }];
        },
        close
      })
    });

    await provider.search("LangChain MCP");
    await provider.close?.();

    expect(close).toHaveBeenCalledTimes(1);
  });
});

describe("normalizeTavilySearchOutput", () => {
  it("accepts MCP text content blocks and strips oversized snippets", () => {
    const output = [
      {
        type: "text",
        text: JSON.stringify({
          results: [
            {
              title: "Aiko",
              url: "https://example.com/aiko",
              content: "x".repeat(900)
            }
          ]
        })
      }
    ];

    const results = normalizeTavilySearchOutput(output);

    expect(results[0]?.snippet.length).toBeLessThanOrEqual(503);
    expect(results[0]).toMatchObject({
      title: "Aiko",
      url: "https://example.com/aiko",
      source: "tavily-mcp"
    });
  });
});

function tavilyConfig(overrides: Partial<AppConfig["mcp"]["tavily"]> = {}): AppConfig["mcp"]["tavily"] {
  return {
    enabled: true,
    mode: "stdio",
    apiKey: "tvly-secret",
    apiKeys: ["tvly-secret"],
    remoteUrl: "https://mcp.tavily.com/mcp/",
    packageName: "tavily-mcp@0.2.19",
    maxResults: 5,
    timeoutMs: 15000,
    ...overrides
  };
}

function fakeClient(tools: McpToolLike[], close?: () => Promise<void>): McpClientLike {
  return {
    async getTools() {
      return tools;
    },
    close
  };
}
