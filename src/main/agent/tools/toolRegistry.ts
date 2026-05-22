import type { ToolHint } from "../types";

export type AikoToolDefinition = ToolHint & {
  description: string;
  schema: unknown;
  planOnly: boolean;
};

export type AikoToolRegistry = {
  list: () => AikoToolDefinition[];
  get: (name: string) => AikoToolDefinition | null;
};

const DEFAULT_TOOLS: AikoToolDefinition[] = [
  {
    name: "open_application",
    description: "提出打开 Windows 应用的待确认动作.只生成动作,不执行.",
    capability: "open_application",
    risk: "low",
    requiresConfirmation: true,
    schema: {
      query: "string",
      source: "string?"
    },
    planOnly: true
  },
  {
    name: "open_url",
    description: "提出打开 URL 的待确认动作.只生成动作,不执行.",
    capability: "open_url",
    risk: "low",
    requiresConfirmation: true,
    schema: {
      url: "string",
      source: "string?"
    },
    planOnly: true
  },
  {
    name: "web_search",
    description: "提出用默认浏览器搜索网页的待确认动作.只生成动作,不执行.",
    capability: "open_url",
    risk: "low",
    requiresConfirmation: true,
    schema: {
      query: "string",
      source: "string?"
    },
    planOnly: true
  },
  {
    name: "create_reminder",
    description: "提出按分钟或小时创建相对提醒的待确认动作.只生成动作,不执行.",
    capability: "create_reminder",
    risk: "low",
    requiresConfirmation: true,
    schema: {
      amount: "number",
      unit: "minutes|hours",
      title: "string",
      source: "string?"
    },
    planOnly: true
  },
  {
    name: "recall_memory",
    description: "查询本地长期记忆.只用于上下文检索,不执行系统操作.",
    capability: "recall_memory",
    risk: "low",
    requiresConfirmation: false,
    schema: {
      query: "string",
      limit: "number?"
    },
    planOnly: true
  },
  {
    name: "list_reminders",
    description: "查询本地提醒列表.只读取提醒,不创建或修改提醒.",
    capability: "list_reminders",
    risk: "low",
    requiresConfirmation: false,
    schema: {},
    planOnly: true
  }
];

// 创建默认工具注册表, 为 Planner 和模型工具提供统一元信息.
export function createDefaultToolRegistry(): AikoToolRegistry {
  const tools = DEFAULT_TOOLS.map(cloneToolDefinition);
  const byName = new Map(tools.map((definition) => [definition.name, definition]));

  return {
    // 列出当前 Agent 可以规划的工具.
    list() {
      return tools.map(cloneToolDefinition);
    },

    // 根据工具名查找工具定义.
    get(name: string) {
      const definition = byName.get(name);
      return definition ? cloneToolDefinition(definition) : null;
    }
  };
}

// 克隆工具定义, 避免调用方修改注册表内部状态.
function cloneToolDefinition(definition: AikoToolDefinition): AikoToolDefinition {
  return {
    ...definition
  };
}
