import dotenv from "dotenv";

export type AppConfig = {
  glm: {
    baseUrl: string;
    model: string;
    fallbackModels: string[];
    apiKey: string;
  };
  mcp: {
    tavily: {
      enabled: boolean;
      mode: "stdio" | "remote";
      apiKey: string;
      apiKeys: string[];
      remoteUrl: string;
      packageName: string;
      maxResults: number;
      timeoutMs: number;
    };
  };
  voice: {
    asr: {
      enabled: boolean;
      provider: "faster-whisper";
      baseUrl: string;
      language: string;
      timeoutMs: number;
    };
    tts: {
      enabled: boolean;
      provider: "cosyvoice";
      baseUrl: string;
      voice: string;
      format: "wav" | "mp3";
      timeoutMs: number;
    };
  };
};

const DEFAULT_GLM_FALLBACK_MODELS = ["glm-4v-flash"];
const DEFAULT_TAVILY_MCP_PACKAGE = "tavily-mcp@0.2.19";
const DEFAULT_TAVILY_REMOTE_URL = "https://mcp.tavily.com/mcp/";
const DEFAULT_TAVILY_MAX_RESULTS = 5;
const DEFAULT_TAVILY_TIMEOUT_MS = 15000;
const DEFAULT_ASR_BASE_URL = "http://127.0.0.1:9001";
const DEFAULT_TTS_BASE_URL = "http://127.0.0.1:9002";
const ALLOWED_TAVILY_MCP_PACKAGES = new Set([DEFAULT_TAVILY_MCP_PACKAGE]);
const ALLOWED_TAVILY_REMOTE_HOSTS = new Set(["mcp.tavily.com"]);

// 从环境变量解析应用运行所需的模型配置.
export function parseEnv(env: NodeJS.ProcessEnv): AppConfig {
  const baseUrl = readRequired(env, "GLM_BASE_URL");
  const model = readRequired(env, "GLM_MODEL");
  const fallbackModels = readFallbackModels(env, model);
  const apiKey = readRequired(env, "GLM_API_KEY");
  const tavily = readTavilyMcpConfig(env);
  const voice = readVoiceConfig(env);

  return {
    glm: {
      baseUrl: baseUrl.replace(/\/$/, ""),
      model,
      fallbackModels,
      apiKey
    },
    mcp: {
      tavily
    },
    voice
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

// 读取 Tavily MCP 配置, 默认关闭, 避免没有 API key 时影响本地桌宠启动.
function readTavilyMcpConfig(env: NodeJS.ProcessEnv): AppConfig["mcp"]["tavily"] {
  const enabled = readBoolean(env, "MCP_TAVILY_ENABLED", false);
  const mode = readTavilyMode(env.MCP_TAVILY_MODE);
  const apiKeys = readTavilyApiKeys(env, enabled);
  const apiKey = apiKeys[0] ?? "";

  return {
    enabled,
    mode,
    apiKey,
    apiKeys,
    remoteUrl: readTavilyRemoteUrl(env.MCP_TAVILY_REMOTE_URL),
    packageName: readTavilyPackageName(env.MCP_TAVILY_PACKAGE),
    maxResults: readPositiveInteger(env, "MCP_TAVILY_MAX_RESULTS", DEFAULT_TAVILY_MAX_RESULTS),
    timeoutMs: readPositiveInteger(env, "MCP_TAVILY_TIMEOUT_MS", DEFAULT_TAVILY_TIMEOUT_MS)
  };
}

// 读取本地语音配置, 默认保留关闭状态, 避免未启动本地服务时影响桌宠启动.
function readVoiceConfig(env: NodeJS.ProcessEnv): AppConfig["voice"] {
  return {
    asr: {
      enabled: readBoolean(env, "AIKO_ASR_ENABLED", false),
      provider: readAsrProvider(env.AIKO_ASR_PROVIDER),
      baseUrl: readLocalHttpUrl(env.AIKO_ASR_BASE_URL, DEFAULT_ASR_BASE_URL, "AIKO_ASR_BASE_URL"),
      language: readOptional(env, "AIKO_ASR_LANGUAGE") || "zh",
      timeoutMs: readPositiveInteger(env, "AIKO_ASR_TIMEOUT_MS", 30000)
    },
    tts: {
      enabled: readBoolean(env, "AIKO_TTS_ENABLED", false),
      provider: readTtsProvider(env.AIKO_TTS_PROVIDER),
      baseUrl: readLocalHttpUrl(env.AIKO_TTS_BASE_URL, DEFAULT_TTS_BASE_URL, "AIKO_TTS_BASE_URL"),
      voice: readOptional(env, "AIKO_TTS_VOICE") || "aiko",
      format: readTtsFormat(env.AIKO_TTS_FORMAT),
      timeoutMs: readPositiveInteger(env, "AIKO_TTS_TIMEOUT_MS", 30000)
    }
  };
}

// 读取 Tavily API key 列表, 优先使用 TAVILY_API_KEYS, 并兼容旧的 TAVILY_API_KEY.
function readTavilyApiKeys(env: NodeJS.ProcessEnv, enabled: boolean): string[] {
  const rawValues = [readOptional(env, "TAVILY_API_KEYS"), readOptional(env, "TAVILY_API_KEY")].filter(Boolean);
  const keys = dedupeStrings(
    rawValues.flatMap((value) =>
      value
        .split(/[,\s;]+/)
        .map((key) => key.trim())
        .filter(Boolean)
    )
  );

  if (enabled && keys.length === 0) {
    throw new Error("Missing required environment variable: TAVILY_API_KEY or TAVILY_API_KEYS");
  }

  return keys;
}

// 按原始顺序去重字符串, 保证 key 轮询顺序可预测.
function dedupeStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

// 读取可选字符串, 空字符串会被视为未配置.
function readOptional(env: NodeJS.ProcessEnv, name: string): string {
  return env[name]?.trim() ?? "";
}

// 读取布尔型环境变量, 支持常见开关写法.
function readBoolean(env: NodeJS.ProcessEnv, name: string, fallback: boolean): boolean {
  const value = readOptional(env, name).toLowerCase();
  if (!value) return fallback;
  if (["1", "true", "yes", "on"].includes(value)) return true;
  if (["0", "false", "no", "off"].includes(value)) return false;
  throw new Error(`Invalid boolean environment variable: ${name}`);
}

// 读取 Tavily MCP 连接方式, 当前支持本地 stdio 和远程 HTTP.
function readTavilyMode(value: string | undefined): "stdio" | "remote" {
  const normalized = value?.trim().toLowerCase() || "stdio";
  if (normalized === "stdio" || normalized === "remote") return normalized;
  throw new Error("Invalid MCP_TAVILY_MODE, expected stdio or remote");
}

// Tavily stdio 模式会启动本地 npm 包, 所以只能接受固定白名单包名.
function readTavilyPackageName(value: string | undefined): string {
  const packageName = readOptional({ MCP_TAVILY_PACKAGE: value }, "MCP_TAVILY_PACKAGE") || DEFAULT_TAVILY_MCP_PACKAGE;
  if (ALLOWED_TAVILY_MCP_PACKAGES.has(packageName)) return packageName;
  throw new Error("Invalid MCP_TAVILY_PACKAGE, only approved Tavily MCP packages are allowed");
}

// Tavily remote 模式只允许官方 HTTPS endpoint, 避免任意 MCP server 混入外部指令.
function readTavilyRemoteUrl(value: string | undefined): string {
  const remoteUrl = readOptional({ MCP_TAVILY_REMOTE_URL: value }, "MCP_TAVILY_REMOTE_URL") || DEFAULT_TAVILY_REMOTE_URL;
  const parsed = new URL(remoteUrl);
  if (parsed.protocol !== "https:" || !ALLOWED_TAVILY_REMOTE_HOSTS.has(parsed.hostname)) {
    throw new Error("Invalid MCP_TAVILY_REMOTE_URL, only approved Tavily HTTPS hosts are allowed");
  }
  return parsed.toString();
}

// 语音服务第一阶段只允许 faster-whisper, 防止配置漂移到未实现 provider.
function readAsrProvider(value: string | undefined): "faster-whisper" {
  const provider = value?.trim().toLowerCase() || "faster-whisper";
  if (provider === "faster-whisper") return provider;
  throw new Error("Invalid AIKO_ASR_PROVIDER, expected faster-whisper");
}

// TTS 第一阶段固定 CosyVoice, 后续可在此扩展 GPT-SoVITS 等高质量 provider.
function readTtsProvider(value: string | undefined): "cosyvoice" {
  const provider = value?.trim().toLowerCase() || "cosyvoice";
  if (provider === "cosyvoice") return provider;
  throw new Error("Invalid AIKO_TTS_PROVIDER, expected cosyvoice");
}

// 限制本地语音服务 URL, 避免 renderer 文本被发送到任意远端主机.
function readLocalHttpUrl(value: string | undefined, fallback: string, name: string): string {
  const raw = readOptional({ [name]: value }, name) || fallback;
  const parsed = new URL(raw);
  const localHosts = new Set(["127.0.0.1", "localhost", "::1"]);
  if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || !localHosts.has(parsed.hostname)) {
    throw new Error(`Invalid ${name}, only local speech service URLs are allowed`);
  }
  return parsed.toString().replace(/\/$/, "");
}

// 读取 TTS 输出格式, 当前只接 wav 和 mp3.
function readTtsFormat(value: string | undefined): "wav" | "mp3" {
  const format = value?.trim().toLowerCase() || "wav";
  if (format === "wav" || format === "mp3") return format;
  throw new Error("Invalid AIKO_TTS_FORMAT, expected wav or mp3");
}

// 读取正整数配置, 避免超时和结果数量被配置成不可用值.
function readPositiveInteger(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const value = readOptional(env, name);
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid positive integer environment variable: ${name}`);
  }
  return parsed;
}
