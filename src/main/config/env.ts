import dotenv from "dotenv";

export type AppConfig = {
  glm: {
    baseUrl: string;
    model: string;
    apiKey: string;
  };
};

// 从环境变量解析应用运行所需的模型配置.
export function parseEnv(env: NodeJS.ProcessEnv): AppConfig {
  const baseUrl = readRequired(env, "GLM_BASE_URL");
  const model = readRequired(env, "GLM_MODEL");
  const apiKey = readRequired(env, "GLM_API_KEY");

  return {
    glm: {
      baseUrl: baseUrl.replace(/\/$/, ""),
      model,
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
