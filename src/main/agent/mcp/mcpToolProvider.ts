import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import type { ClientConfig } from "@langchain/mcp-adapters";
import type { RunnableConfig } from "@langchain/core/runnables";

export type McpToolLike = {
  name: string;
  description?: string;
  invoke: (input: unknown, options?: RunnableConfig) => Promise<unknown>;
};

export type McpClientLike = {
  getTools: (...servers: string[]) => Promise<McpToolLike[]>;
  close?: () => Promise<void>;
};

export type McpClientFactory = (config: ClientConfig) => McpClientLike;

// 创建 LangChain MCP 客户端, 让 Aiko 的外部能力统一走 MCP adapter.
export function createLangChainMcpClient(config: ClientConfig): McpClientLike {
  return new MultiServerMCPClient(config) as unknown as McpClientLike;
}
