import dotenv from "dotenv";

export type AppConfig = {
  glm: {
    baseUrl: string;
    model: string;
    fallbackModels: string[];
    apiKey: string;
  };
};

const DEFAULT_GLM_FALLBACK_MODELS = ["glm-4v-flash"];

// 从环境变量解析应用运行所需的模型配置.
export function parseEnv(env: NodeJS.ProcessEnv): AppConfig {
  const baseUrl = readRequired(env, "GLM_BASE_URL");
  const model = readRequired(env, "GLM_MODEL");
  const fallbackModels = readFallbackModels(env, model);
  const apiKey = readRequired(env, "GLM_API_KEY");

  return {
    glm: {
      baseUrl: baseUrl.replace(/\/$/, ""),
      model,
      fallbackModels,
      apiKey
    }
  };
}

// 加载 .env 文件并返回标准化配置.
export function loadConfig(): AppConfig {
  dotenv.config();
  return parseEnv(process.env);
}

// 读取必填环境变量, 缺失时抛出明确错误.
function readRequired(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value.trim();
}

// 读取备用模型列表, 默认把旧的 glm-4v-flash 作为限流兜底.
function readFallbackModels(env: NodeJS.ProcessEnv, primaryModel: string): string[] {
  const configuredModels = env.GLM_FALLBACK_MODELS
    ?.split(/[,\s;]+/)
    .map((model) => model.trim())
    .filter(Boolean);
  const candidates = configuredModels && configuredModels.length > 0 ? configuredModels : DEFAULT_GLM_FALLBACK_MODELS;
  const seen = new Set([primaryModel]);
  const fallbackModels: string[] = [];

  for (const model of candidates) {
    if (seen.has(model)) continue;
    seen.add(model);
    fallbackModels.push(model);
  }

  return fallbackModels;
}
