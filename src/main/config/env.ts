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
      realtimeEnabled: boolean;
      appId: string;
      provider: "tencent-cloud";
      secretId: string;
      secretKey: string;
      region: string;
      engineModelType: string;
      voiceFormat: TencentAsrVoiceFormat;
      language: string;
      timeoutMs: number;
    };
    tts: {
      enabled: boolean;
      provider: "tencent-cloud";
      secretId: string;
      secretKey: string;
      region: string;
      voiceType: number;
      voiceName: string;
      format: "wav" | "mp3";
      sampleRate: 8000 | 16000 | 24000;
      timeoutMs: number;
    };
  };
  companion: {
    enabled: boolean;
    intervalHours: number;
    ttsEnabled: boolean;
    quietStartHour: number;
    quietEndHour: number;
  };
};

export type TencentAsrVoiceFormat = "wav" | "mp3" | "m4a" | "aac" | "ogg-opus" | "pcm";

const DEFAULT_GLM_FALLBACK_MODELS = ["glm-4v-flash"];
const DEFAULT_TAVILY_MCP_PACKAGE = "tavily-mcp@0.2.19";
const DEFAULT_TAVILY_REMOTE_URL = "https://mcp.tavily.com/mcp/";
const DEFAULT_TAVILY_MAX_RESULTS = 5;
const DEFAULT_TAVILY_TIMEOUT_MS = 15000;
const DEFAULT_TENCENT_REGION = "ap-shanghai";
const DEFAULT_TENCENT_ASR_ENGINE = "16k_zh";
const DEFAULT_TENCENT_ASR_FORMAT: TencentAsrVoiceFormat = "wav";
const DEFAULT_TENCENT_TTS_VOICE_TYPE = 603007;
const DEFAULT_TENCENT_TTS_VOICE_NAME = "邻家女孩";
const DEFAULT_TENCENT_TTS_SAMPLE_RATE: AppConfig["voice"]["tts"]["sampleRate"] = 24000;
const DEFAULT_COMPANION_INTERVAL_HOURS = 24;
const DEFAULT_COMPANION_QUIET_START_HOUR = 23;
const DEFAULT_COMPANION_QUIET_END_HOUR = 8;
const ALLOWED_TAVILY_MCP_PACKAGES = new Set([DEFAULT_TAVILY_MCP_PACKAGE]);
const ALLOWED_TAVILY_REMOTE_HOSTS = new Set(["mcp.tavily.com"]);
const ALLOWED_ASR_FORMATS = new Set<TencentAsrVoiceFormat>(["wav", "mp3", "m4a", "aac", "ogg-opus", "pcm"]);
const ALLOWED_TTS_SAMPLE_RATES = new Set([8000, 16000, 24000]);

// 从环境变量解析应用运行所需的模型, MCP 和语音配置.
export function parseEnv(env: NodeJS.ProcessEnv): AppConfig {
  const baseUrl = readRequired(env, "GLM_BASE_URL");
  const model = readRequired(env, "GLM_MODEL");
  const fallbackModels = readFallbackModels(env, model);
  const apiKey = readRequired(env, "GLM_API_KEY");
  const tavily = readTavilyMcpConfig(env);
  const voice = readVoiceConfig(env);
  const companion = readCompanionConfig(env);

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
    voice,
    companion
  };
}

// 读取桌宠主动陪伴配置, 默认每天最多轻量出现一次并避开安静时段.
function readCompanionConfig(env: NodeJS.ProcessEnv): AppConfig["companion"] {
  return {
    enabled: readBoolean(env, "AIKO_COMPANION_ENABLED", true),
    intervalHours: readPositiveInteger(env, "AIKO_COMPANION_INTERVAL_HOURS", DEFAULT_COMPANION_INTERVAL_HOURS),
    ttsEnabled: readBoolean(env, "AIKO_COMPANION_TTS_ENABLED", false),
    quietStartHour: readHour(env, "AIKO_COMPANION_QUIET_START_HOUR", DEFAULT_COMPANION_QUIET_START_HOUR),
    quietEndHour: readHour(env, "AIKO_COMPANION_QUIET_END_HOUR", DEFAULT_COMPANION_QUIET_END_HOUR)
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

// 读取备用模型列表, 默认用 glm-4v-flash 兜底限流.
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

// 读取 Tavily MCP 配置, 默认关闭, 避免没有 API key 时影响桌宠启动.
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

// 读取腾讯云语音配置, ASR/TTS 任一启用时必须提供 SecretId 和 SecretKey.
function readVoiceConfig(env: NodeJS.ProcessEnv): AppConfig["voice"] {
  const asrEnabled = readBoolean(env, "AIKO_ASR_ENABLED", false);
  const asrRealtimeEnabled = readBoolean(env, "AIKO_ASR_REALTIME_ENABLED", false);
  const ttsEnabled = readBoolean(env, "AIKO_TTS_ENABLED", false);
  const credentials = readTencentCredentials(env, asrEnabled || ttsEnabled);
  const appId = readTencentAppId(env, asrRealtimeEnabled);
  const region = readOptional(env, "TENCENTCLOUD_REGION") || DEFAULT_TENCENT_REGION;

  return {
    asr: {
      enabled: asrEnabled,
      realtimeEnabled: asrRealtimeEnabled,
      appId,
      provider: readAsrProvider(env.AIKO_ASR_PROVIDER),
      secretId: credentials.secretId,
      secretKey: credentials.secretKey,
      region,
      engineModelType: readOptional(env, "AIKO_ASR_ENGINE_MODEL_TYPE") || DEFAULT_TENCENT_ASR_ENGINE,
      voiceFormat: readAsrVoiceFormat(env.AIKO_ASR_VOICE_FORMAT),
      language: readOptional(env, "AIKO_ASR_LANGUAGE") || "zh",
      timeoutMs: readPositiveInteger(env, "AIKO_ASR_TIMEOUT_MS", 30000)
    },
    tts: {
      enabled: ttsEnabled,
      provider: readTtsProvider(env.AIKO_TTS_PROVIDER),
      secretId: credentials.secretId,
      secretKey: credentials.secretKey,
      region,
      voiceType: readPositiveInteger(env, "AIKO_TTS_VOICE_TYPE", DEFAULT_TENCENT_TTS_VOICE_TYPE),
      voiceName: readOptional(env, "AIKO_TTS_VOICE_NAME") || DEFAULT_TENCENT_TTS_VOICE_NAME,
      format: readTtsFormat(env.AIKO_TTS_FORMAT),
      sampleRate: readTtsSampleRate(env.AIKO_TTS_SAMPLE_RATE),
      timeoutMs: readPositiveInteger(env, "AIKO_TTS_TIMEOUT_MS", 30000)
    }
  };
}

// 读取腾讯云 AppId, 只有实时 ASR WebSocket 需要它.
function readTencentAppId(env: NodeJS.ProcessEnv, required: boolean) {
  const appId = readOptional(env, "TENCENTCLOUD_APP_ID");
  if (required && !appId) {
    throw new Error("Missing required environment variable: TENCENTCLOUD_APP_ID");
  }
  return appId;
}

// 读取腾讯云访问密钥, 未启用云语音时允许为空.
function readTencentCredentials(env: NodeJS.ProcessEnv, required: boolean) {
  const secretId = readOptional(env, "TENCENTCLOUD_SECRET_ID");
  const secretKey = readOptional(env, "TENCENTCLOUD_SECRET_KEY");
  if (required && (!secretId || !secretKey)) {
    throw new Error("Missing required environment variable: TENCENTCLOUD_SECRET_ID or TENCENTCLOUD_SECRET_KEY");
  }
  return { secretId, secretKey };
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

// Tavily stdio 模式会启动本地 npm 包, 所以只接受固定白名单包名.
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

// 语音输入固定为腾讯云 ASR, 防止配置漂移到未实现 provider.
function readAsrProvider(value: string | undefined): "tencent-cloud" {
  const provider = value?.trim().toLowerCase() || "tencent-cloud";
  if (provider === "tencent-cloud") return provider;
  throw new Error("Invalid AIKO_ASR_PROVIDER, expected tencent-cloud");
}

// 语音输出固定为腾讯云 TTS, 后续可以在 provider 层扩展更多云服务.
function readTtsProvider(value: string | undefined): "tencent-cloud" {
  const provider = value?.trim().toLowerCase() || "tencent-cloud";
  if (provider === "tencent-cloud") return provider;
  throw new Error("Invalid AIKO_TTS_PROVIDER, expected tencent-cloud");
}

// 读取腾讯云一句话识别音频格式, 默认用 WAV 适配浏览器 PCM 录音.
function readAsrVoiceFormat(value: string | undefined): TencentAsrVoiceFormat {
  const format = value?.trim().toLowerCase() || DEFAULT_TENCENT_ASR_FORMAT;
  if (ALLOWED_ASR_FORMATS.has(format as TencentAsrVoiceFormat)) return format as TencentAsrVoiceFormat;
  throw new Error("Invalid AIKO_ASR_VOICE_FORMAT, expected wav, mp3, m4a, aac, ogg-opus, or pcm");
}

// 读取 TTS 输出格式, 当前只接 wav 和 mp3.
function readTtsFormat(value: string | undefined): "wav" | "mp3" {
  const format = value?.trim().toLowerCase() || "wav";
  if (format === "wav" || format === "mp3") return format;
  throw new Error("Invalid AIKO_TTS_FORMAT, expected wav or mp3");
}

// 读取腾讯云 TTS 采样率, 默认 24k 让音色更清晰.
function readTtsSampleRate(value: string | undefined): 8000 | 16000 | 24000 {
  const sampleRate = readPositiveInteger({ AIKO_TTS_SAMPLE_RATE: value }, "AIKO_TTS_SAMPLE_RATE", DEFAULT_TENCENT_TTS_SAMPLE_RATE);
  if (ALLOWED_TTS_SAMPLE_RATES.has(sampleRate)) return sampleRate as 8000 | 16000 | 24000;
  throw new Error("Invalid AIKO_TTS_SAMPLE_RATE, expected 8000, 16000, or 24000");
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

// 读取 0 到 23 的小时配置, 用于主动陪伴的安静时段.
function readHour(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const value = readOptional(env, name);
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 23) {
    throw new Error(`Invalid hour environment variable: ${name}`);
  }
  return parsed;
}
