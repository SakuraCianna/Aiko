import dotenv from "dotenv";

export type AppConfig = {
  glm: {
    baseUrl: string;
    model: string;
    apiKey: string;
  };
};

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

export function loadConfig(): AppConfig {
  dotenv.config();
  return parseEnv(process.env);
}

function readRequired(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value.trim();
}
