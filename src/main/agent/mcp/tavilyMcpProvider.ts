import type { ClientConfig } from "@langchain/mcp-adapters";
import type { AppConfig } from "../../config/env";
import { createLangChainMcpClient } from "./mcpToolProvider";
import type { McpClientFactory, McpToolLike } from "./mcpToolProvider";
import type { WebSearchOptions, WebSearchProvider, WebSearchResult } from "../retriever/webTypes";

type TavilyMcpConfig = AppConfig["mcp"]["tavily"];

export type TavilyWebSearchProviderOptions = {
  createClient?: McpClientFactory;
};

// 根据 Aiko 配置生成 LangChain MCP adapter 可直接使用的 Tavily client 配置.
export function buildTavilyMcpClientConfig(config: TavilyMcpConfig): ClientConfig {
  const server =
    config.mode === "remote"
      ? {
          transport: "http" as const,
          url: appendTavilyApiKey(config.remoteUrl, config.apiKey),
          automaticSSEFallback: true,
          defaultToolTimeout: config.timeoutMs
        }
      : {
          transport: "stdio" as const,
          command: "npx",
          args: ["-y", config.packageName],
          env: {
            TAVILY_API_KEY: config.apiKey
          },
          stderr: "pipe" as const,
          defaultToolTimeout: config.timeoutMs,
          restart: {
            enabled: true,
            maxAttempts: 2,
            delayMs: 1000
          }
        };

  return {
    onConnectionError: "ignore",
    throwOnLoadError: false,
    useStandardContentBlocks: true,
    defaultToolTimeout: config.timeoutMs,
    mcpServers: {
      tavily: server
    }
  };
}

// 创建 Tavily 网页搜索 provider, 对外只暴露 Aiko 需要的 search 能力.
export function createTavilyWebSearchProvider(
  config: TavilyMcpConfig,
  options: TavilyWebSearchProviderOptions = {}
): WebSearchProvider {
  const apiKeys = config.apiKeys.length > 0 ? config.apiKeys : [config.apiKey].filter(Boolean);
  let activeKeyIndex = 0;
  let toolsPromise: Promise<McpToolLike[]> | null = null;
  let client = null as ReturnType<McpClientFactory> | null;

  return {
    // 懒加载 MCP 工具, 避免桌宠启动时因为网络或 npx 初始化阻塞界面.
    async search(query: string, searchOptions: WebSearchOptions = {}) {
      for (let attempt = 0; attempt < Math.max(apiKeys.length, 1); attempt += 1) {
        const searchTool = await loadSearchTool();
        if (!searchTool) {
          console.warn("[aiko:mcp] Tavily search tool unavailable");
          return [];
        }

        try {
          const output = await searchTool.invoke(
            {
              query,
              max_results: normalizeMaxResults(searchOptions.maxResults ?? config.maxResults),
              include_answer: true,
              include_raw_content: false,
              search_depth: "basic"
            },
            {
              timeout: config.timeoutMs,
              signal: searchOptions.signal
            }
          );
          return normalizeTavilySearchOutput(output);
        } catch (error) {
          console.warn("[aiko:mcp] Tavily search failed", {
            ...formatMcpError(error),
            keyIndex: activeKeyIndex + 1
          });
          if (!canRotateKey(attempt)) return [];
          await rotateToNextKey();
        }
      }

      return [];
    },

    // 关闭底层 MCP client, stdio 模式下会释放 MCP server 子进程.
    async close() {
      await client?.close?.();
      client = null;
      toolsPromise = null;
    }
  };

  // 只初始化一次当前 key 的工具列表, 后续搜索复用同一个加载结果.
  function loadToolsOnce() {
    if (!toolsPromise) {
      const createClient = options.createClient ?? createLangChainMcpClient;
      client = createClient(buildTavilyMcpClientConfig(getActiveConfig()));
      toolsPromise = client.getTools("tavily");
    }
    return toolsPromise;
  }

  // 加载当前 key 对应的 Tavily 搜索工具.
  async function loadSearchTool(): Promise<McpToolLike | null> {
    const tools = await loadToolsOnce();
    return findTavilyTool(tools, ["tavily-search", "tavily_search", "search"]);
  }

  // 生成当前 key 的配置快照, 避免把轮换状态写回全局配置.
  function getActiveConfig(): TavilyMcpConfig {
    return {
      ...config,
      apiKey: apiKeys[activeKeyIndex] ?? config.apiKey
    };
  }

  // 判断是否还有下一个 key 可尝试.
  function canRotateKey(attempt: number): boolean {
    return apiKeys.length > 1 && attempt < apiKeys.length - 1;
  }

  // 切换到下一个 key, 同时关闭旧 MCP client.
  async function rotateToNextKey() {
    await client?.close?.();
    client = null;
    toolsPromise = null;
    activeKeyIndex = (activeKeyIndex + 1) % apiKeys.length;
  }
}

// 把 Tavily MCP 的不同返回形态规整成 Aiko 内部网页搜索结果.
export function normalizeTavilySearchOutput(output: unknown): WebSearchResult[] {
  const parsed = parseMcpOutput(output);
  const results = readResultItems(parsed);

  return results
    .map((item): WebSearchResult | null => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const url = readString(record.url);
      if (!url) return null;
      return {
        title: readString(record.title) || url,
        url,
        snippet: trimSnippet(readString(record.content) || readString(record.snippet) || readString(record.answer)),
        source: "tavily-mcp",
        publishedDate: readString(record.published_date) || readString(record.publishedDate) || undefined,
        score: readNumber(record.score)
      };
    })
    .filter((item): item is WebSearchResult => Boolean(item));
}

// 读取 Tavily 返回的 results 数组, 同时兼容直接返回数组的 MCP 实现.
function readResultItems(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === "object") {
    const results = (parsed as { results?: unknown }).results;
    return Array.isArray(results) ? results : [];
  }
  return [];
}

// 为远程 MCP URL 添加 Tavily key, 避免调用方手动拼接敏感查询参数.
function appendTavilyApiKey(baseUrl: string, apiKey: string): string {
  const url = new URL(baseUrl);
  url.searchParams.set("tavilyApiKey", apiKey);
  return url.toString();
}

// 从 MCP 工具列表里按名称匹配 Tavily 搜索工具.
function findTavilyTool(tools: McpToolLike[], candidates: string[]): McpToolLike | null {
  const normalizedCandidates = new Set(candidates.map(normalizeToolName));
  return tools.find((tool) => normalizedCandidates.has(normalizeToolName(tool.name))) ?? null;
}

// 统一工具名称里的大小写, 下划线和服务名前缀差异.
function normalizeToolName(name: string): string {
  return name.toLowerCase().replace(/^tavily__/, "").replace(/_/g, "-");
}

// 解析 MCP 工具输出, 支持对象, JSON 字符串和标准 content blocks.
function parseMcpOutput(output: unknown): unknown {
  if (typeof output === "string") return parseJsonOrText(output);
  if (Array.isArray(output)) {
    const text = output
      .map((part) => {
        if (!part || typeof part !== "object") return "";
        return readString((part as Record<string, unknown>).text);
      })
      .filter(Boolean)
      .join("\n");
    return parseJsonOrText(text);
  }
  if (output && typeof output === "object") {
    const record = output as Record<string, unknown>;
    if (Array.isArray(record.content)) return parseMcpOutput(record.content);
    return output;
  }
  return null;
}

// 优先解析 JSON, 解析失败时返回空结构.
function parseJsonOrText(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return parseDetailedTextResults(text);
  }
}

// 解析 tavily-mcp 返回的 "Detailed Results" 文本格式.
function parseDetailedTextResults(text: string): unknown[] {
  const results: Array<{ title: string; url: string; content: string }> = [];
  const normalized = text.replace(/\r\n/g, "\n");
  const pattern = /Title:\s*(.+?)\nURL:\s*(https?:\/\/\S+)\nContent:\s*([\s\S]*?)(?=\n\s*Title:|\s*$)/g;

  for (const match of normalized.matchAll(pattern)) {
    const title = match[1]?.trim();
    const url = match[2]?.trim();
    const content = match[3]?.trim();
    if (!title || !url) continue;
    results.push({
      title,
      url,
      content: content ?? ""
    });
  }

  return results;
}

// Tavily MCP 的 max_results schema 最小值是 5, 最大值是 20.
function normalizeMaxResults(value: number): number {
  return Math.max(5, Math.min(20, Math.trunc(value)));
}

// 读取字符串字段, 防止把对象直接塞进模型上下文.
function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

// 读取数值字段, 非数字时保持未定义.
function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

// 限制网页摘要长度, 避免单个搜索结果撑爆上下文.
function trimSnippet(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= 500) return normalized;
  return `${normalized.slice(0, 500)}...`;
}

// 只打印可恢复的诊断信息, 不把 API key 或请求体写进日志.
function formatMcpError(error: unknown) {
  return {
    name: error instanceof Error ? error.name : typeof error,
    message: error instanceof Error ? sanitizeSecretText(error.message) : sanitizeSecretText(String(error))
  };
}

// 对常见密钥形态做脱敏, 方便用户测试时收集日志.
function sanitizeSecretText(text: string): string {
  return text
    .replace(/tavilyApiKey=[^&\s]+/gi, "tavilyApiKey=[redacted]")
    .replace(/tvly-[A-Za-z0-9._-]+/gi, "tvly-[redacted]");
}
