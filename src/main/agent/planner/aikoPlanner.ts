import type { PendingActionDto } from "../../../shared/ipcTypes";
import { describePendingAction } from "../../ai/aikoVoice";
import { detectCurrentKnowledgeIntent } from "../knowledge/currentKnowledgeProvider";
import type { AikoPlan, PlannerInput } from "../types";

export type AikoPlanner = {
  plan: (input: PlannerInput) => Promise<AikoPlan>;
};

export type AikoPlannerOptions = {
  now?: () => Date;
};

type DetectedAction = {
  message: string;
  action: PendingActionDto;
};

// 创建 Aiko Planner, 负责把用户输入转换成结构化计划.
export function createAikoPlanner(options: AikoPlannerOptions = {}): AikoPlanner {
  const now = options.now ?? (() => new Date());
  return {
    // 规划一次请求, 先处理确定性本地动作.
    async plan(input) {
      const actions = detectDeterministicActions(input.userText, input.userTranscript, now);
      if (actions.length === 0) {
        return {
          mode: "chat",
          replyDraft: "",
          steps: [],
          grounding: []
        };
      }

      return {
        mode: "action",
        replyDraft: describeDeterministicPlan(actions),
        steps: actions.map((action) => ({
          kind: "action",
          source: "deterministic",
          action: action.action
        })),
        grounding: actions.map((action) => ({
          source: "deterministic_rule",
          note: action.action.capability
        }))
      };
    }
  };
}

// 从文本和语音转写候选中找出所有确定性动作.
function detectDeterministicActions(userText: string, userTranscript: string, now: () => Date): DetectedAction[] {
  const candidates = [userText, ...userTranscript.split("\n")].filter((candidate) => candidate.trim().length > 0);
  for (const candidate of candidates) {
    const segments = splitCompoundActionText(candidate);
    const actions = segments
      .map((segment) => detectDeterministicAction(segment, now))
      .filter((action): action is DetectedAction => Boolean(action));
    if (actions.length > 0) return actions;
  }
  return [];
}

// 从用户输入中识别可以本地确定处理的简单动作.
export function detectDeterministicAction(input: string, now: () => Date = () => new Date()): DetectedAction | null {
  const text = input.trim();
  if (detectCurrentKnowledgeIntent(text)) return null;

  const defaultApplicationMatch = text.match(/^(?:请|麻烦)?(?:你)?(?:帮我)?(?:将|把)?默认(.+?)改成\s*(.+)$/);
  if (defaultApplicationMatch?.[1] && defaultApplicationMatch?.[2]) {
    const defaultFor = normalizeDefaultApplicationKind(defaultApplicationMatch[1]);
    const application = normalizeApplicationQuery(defaultApplicationMatch[2]);
    return toDetectedAction({
        title: `设置默认应用:${defaultFor}`,
        source: text,
        risk: "low",
        capability: "set_default_application",
        target: defaultFor,
        params: {
          defaultFor,
          application
        }
    });
  }

  if (isReminderCancelRequest(text)) {
    return toDetectedAction({
        title: "取消最近提醒",
        source: text,
        risk: "low",
        capability: "cancel_reminder",
        target: "latest",
        params: {
          target: "latest"
        }
    });
  }

  const openUrlMatch = text.match(/^(?:请|麻烦)?(?:你)?(?:帮我)?(?:打开|访问|开一下)\s*(https?:\/\/\S+)$/i);
  if (openUrlMatch?.[1]) {
    const url = openUrlMatch[1].trim();
    return toDetectedAction({
        title: `打开网页:${url}`,
        source: text,
        risk: "low",
        capability: "open_url",
        target: url
    });
  }

  const bareUrlMatch = text.match(/^(https?:\/\/\S+)$/i);
  if (bareUrlMatch?.[1]) {
    const url = bareUrlMatch[1].trim();
    return toDetectedAction({
        title: `打开网页:${url}`,
        source: text,
        risk: "low",
        capability: "open_url",
        target: url
    });
  }

  const searchMatch = text.match(/^(?:请|麻烦)?(?:你)?(?:帮我)?(?:搜索|搜一下|查一下|查找|找一下)\s*(.+)$/);
  if (searchMatch?.[1]) {
    const query = searchMatch[1].trim();
    return toDetectedAction({
        title: `搜索网页:${query}`,
        source: text,
        risk: "low",
        capability: "open_url",
        target: buildSearchUrl(query)
    });
  }

  const shellCommand = detectShellCommandRequest(text);
  if (shellCommand) return shellCommand;

  const directoryListing = detectDirectoryListingRequest(text);
  if (directoryListing) return directoryListing;

  const fileRead = detectFileReadRequest(text);
  if (fileRead) return fileRead;

  const openMatch = text.match(/^(?:请|麻烦)?(?:你)?(?:帮我)?(?:打开|启动|运行|开启|开一下)\s*(?:一下)?\s*(.+)$/);
  if (openMatch?.[1]) {
    const query = normalizeApplicationQuery(openMatch[1]);
    return toDetectedAction({
        title: `打开应用:${query}`,
        source: text,
        risk: "low",
        capability: "open_application",
        target: query
    });
  }

  const reminderMatch = text.match(/^(?:请|麻烦)?(?:你)?(?:帮我)?(?:(\d+)\s*(分钟|小时)后提醒我|提醒我\s*(\d+)\s*(分钟|小时)后)\s*(.+)$/);
  const reminderAmountText = reminderMatch?.[1] ?? reminderMatch?.[3];
  const reminderUnitLabel = reminderMatch?.[2] ?? reminderMatch?.[4];
  if (reminderAmountText && reminderUnitLabel && reminderMatch?.[5]) {
    const amount = Number(reminderAmountText);
    const unitLabel = reminderUnitLabel;
    const unit = unitLabel === "小时" ? "hours" : "minutes";
    const title = (reminderMatch[5] ?? "").trim();
    return toDetectedAction({
        title: `创建提醒:${title}`,
        source: text,
        risk: "low",
        capability: "create_reminder",
        target: title,
        params: {
          amount,
          unit,
          title
        }
    });
  }

  const absoluteReminder = detectAbsoluteReminder(text, now);
  if (absoluteReminder) return absoluteReminder;

  return null;
}

// 识别用户明确要求执行的 PowerShell 或 Shell 命令, 并保持高风险确认边界.
function detectShellCommandRequest(text: string): DetectedAction | null {
  const match = text.match(/^(?:请|麻烦)?(?:你)?(?:帮我)?(?:运行|执行)\s*(?:PowerShell|powershell|Shell|shell|终端)?\s*(?:命令|指令)\s*(.+)$/);
  const command = cleanupLocalTarget(match?.[1] ?? "");
  if (!command) return null;

  return toDetectedAction({
      title: `执行 Shell:${command}`,
      source: text,
      risk: "high",
      capability: "run_shell_command",
      target: command,
      params: {
        command
      }
  });
}

// 识别明确的本地目录列举请求, 不把普通"查看新闻/天气"误判成文件系统访问.
function detectDirectoryListingRequest(text: string): DetectedAction | null {
  const explicitMatch = text.match(
    /^(?:请|麻烦)?(?:你)?(?:帮我)?(?:列出|查看|看看|显示)\s+(.+?)(?:的)?\s*(?:目录|文件夹)(?:内容|列表)?$/
  );
  const pathLikeMatch = text.match(/^(?:请|麻烦)?(?:你)?(?:帮我)?(?:列出|查看|看看|显示)\s+(.+)$/);
  const target = cleanupLocalTarget(explicitMatch?.[1] ?? (pathLikeMatch?.[1] && looksLikeLocalDirectoryPath(pathLikeMatch[1]) ? pathLikeMatch[1] : ""));
  if (!target || !looksLikeLocalPath(target)) return null;

  return toDetectedAction({
      title: `列出目录:${target}`,
      source: text,
      risk: "medium",
      capability: "list_directory",
      target
  });
}

// 识别明确的本地文本文件读取请求, 读取动作必须进入高风险确认.
function detectFileReadRequest(text: string): DetectedAction | null {
  const match = text.match(/^(?:请|麻烦)?(?:你)?(?:帮我)?(?:读取|读一下|查看|看看)\s+(.+)$/);
  const target = cleanupLocalTarget(match?.[1] ?? "").replace(/(?:文件|内容)$/u, "").trim();
  if (!target || !looksLikeLocalFilePath(target)) return null;

  return toDetectedAction({
      title: `读取文件:${target}`,
      source: text,
      risk: "high",
      capability: "read_file",
      target
  });
}

// 把一句话里的多个本地动作拆成候选片段.
function splitCompoundActionText(input: string): string[] {
  return input
    .split(/(?:然后|接着|顺便|并且|以及|再|，|,|；|;|。)/)
    .map((segment) => segment.trim())
    .filter(Boolean);
}

// 识别"今天下午四点提醒我"这类绝对时间提醒.
function detectAbsoluteReminder(text: string, now: () => Date): DetectedAction | null {
  if (!/(?:提醒|闹钟|叫我|喊我|设定|设置)/.test(text)) return null;
  const time = parseAbsoluteReminderTime(text, now());
  if (!time) return null;
  const title = extractAbsoluteReminderTitle(text) || "提醒";
  return toDetectedAction({
      title: `创建提醒:${title}`,
      source: text,
      risk: "low",
      capability: "create_reminder",
      target: title,
      params: {
        title,
        triggerAt: time.toISOString()
      }
  });
}

// 从提醒文本里提取标题, 没有明确标题时把"闹钟"作为默认标题.
function extractAbsoluteReminderTitle(text: string): string | null {
  const reminderTitle = text.match(/提醒我\s*(.+)$/)?.[1]?.trim();
  if (reminderTitle) {
    return reminderTitle.replace(/^(?:今天|明天)?(?:上午|下午|晚上|中午|凌晨)?[零一二两三四五六七八九十\d:：点半分\s]+(?:钟)?/, "").trim() || "提醒";
  }
  if (text.includes("闹钟")) return "闹钟";
  if (text.includes("提醒")) return "提醒";
  return null;
}

// 解析中文或数字时间, 支持今天/明天, 上午/下午/晚上, 4点/四点/16:30.
function parseAbsoluteReminderTime(text: string, baseTime: Date): Date | null {
  const match = text.match(
    /(?:(今天|明天)\s*)?(上午|下午|晚上|中午|凌晨)?\s*([零〇一二两三四五六七八九十\d]{1,3})(?:[:：点时])\s*([零〇一二两三四五六七八九十\d]{1,3}|半)?/
  );
  if (!match?.[3]) return null;

  const dayLabel = match[1];
  const period = match[2];
  const hour = parseChineseNumber(match[3]);
  if (hour === null || hour > 23) return null;
  const minuteText = match[4];
  const minute = minuteText === "半" ? 30 : minuteText ? parseChineseNumber(minuteText) : 0;
  if (minute === null || minute > 59) return null;

  const target = new Date(baseTime);
  if (dayLabel === "明天") target.setDate(target.getDate() + 1);
  let normalizedHour = hour;
  if ((period === "下午" || period === "晚上") && normalizedHour < 12) normalizedHour += 12;
  if (period === "中午" && normalizedHour < 11) normalizedHour += 12;
  if (period === "凌晨" && normalizedHour === 12) normalizedHour = 0;
  target.setHours(normalizedHour, minute, 0, 0);
  if (!dayLabel && target.getTime() <= baseTime.getTime()) target.setDate(target.getDate() + 1);
  return target;
}

// 把简单中文数字转换为阿拉伯数字.
function parseChineseNumber(input: string): number | null {
  if (/^\d+$/.test(input)) return Number(input);
  const digits: Record<string, number> = {
    零: 0,
    "〇": 0,
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9
  };
  if (input === "十") return 10;
  if (input.includes("十")) {
    const [left, right] = input.split("十");
    const tens = left ? digits[left] : 1;
    const ones = right ? digits[right] : 0;
    if (tens === undefined || ones === undefined) return null;
    return tens * 10 + ones;
  }
  return digits[input] ?? null;
}

// 多动作时给用户一个总览, 单动作时保持原来的 Aiko 语气.
function describeDeterministicPlan(actions: DetectedAction[]): string {
  if (actions.length === 1) return actions[0]?.message ?? "";
  return `我拆成 ${actions.length} 个动作, 等你确认后按顺序执行.`;
}

// 判断用户是否想取消最近一条待触发提醒.
function isReminderCancelRequest(input: string): boolean {
  const text = input
    .trim()
    .replace(/[。.!！?？]+$/g, "")
    .replace(/\s+/g, "");
  if (!text.includes("提醒")) return false;

  return (
    /(?:取消|撤销|删除|移除|关掉).{0,8}(?:刚才|最近|上一个|上一条|那个|这条)?(?:的)?提醒/.test(text)
    || /(?:刚才|最近|上一个|上一条|那个|这条).{0,8}提醒.{0,8}(?:取消|撤销|删除|移除|关掉)/.test(text)
    || /不要(?:再)?提醒我了/.test(text)
  );
}

// 把动作包装成带 Aiko 语气的检测结果.
function toDetectedAction(action: PendingActionDto): DetectedAction {
  return {
    message: describePendingAction(action),
    action
  };
}

// 把常见中文应用叫法归一成更容易匹配到本地应用的名称.
function normalizeApplicationQuery(rawQuery: string): string {
  const query = rawQuery.trim().replace(/[。.!！?？]+$/, "");
  const normalized = query.toLowerCase().replace(/\s+/g, "");
  const aliases: Record<string, string> = {
    google: "Google Chrome",
    googlechrome: "Google Chrome",
    chrome: "Google Chrome",
    谷歌: "Google Chrome",
    谷歌浏览器: "Google Chrome",
    cursor: "Cursor",
    vscode: "VS Code",
    visualstudiocode: "VS Code",
    code: "VS Code"
  };
  return aliases[normalized] ?? query;
}

// 归一化用户口中的默认应用类别.
function normalizeDefaultApplicationKind(rawKind: string): string {
  const kind = rawKind.trim().replace(/[。.!！?？]+$/, "");
  const normalized = kind.toLowerCase().replace(/\s+/g, "");
  const aliases: Record<string, string> = {
    browser: "浏览器",
    webbrowser: "浏览器",
    浏览器: "浏览器",
    网页浏览器: "浏览器"
  };
  return aliases[normalized] ?? kind;
}

// 清理本地目标路径或命令外围标点, 不改变内部空格和反斜杠.
function cleanupLocalTarget(input: string): string {
  return input.trim().replace(/^["'“”‘’]+|["'“”‘’。.!！?？]+$/g, "").trim();
}

// 判断文本是否像本地路径, 避免普通知识查询进入文件系统动作.
function looksLikeLocalPath(input: string): boolean {
  const target = cleanupLocalTarget(input);
  return /^[a-zA-Z]:[\\/]/.test(target) || /^[.]{1,2}[\\/]/.test(target) || target.includes("\\") || target.includes("/");
}

// 判断文本是否像目录路径.
function looksLikeLocalDirectoryPath(input: string): boolean {
  const target = cleanupLocalTarget(input);
  return looksLikeLocalPath(target) && !/\.[a-zA-Z0-9]{1,12}$/.test(target);
}

// 判断文本是否像可读取的本地文本文件路径.
function looksLikeLocalFilePath(input: string): boolean {
  const target = cleanupLocalTarget(input);
  return looksLikeLocalPath(target) && /\.(?:txt|md|markdown|json|jsonl|ts|tsx|js|jsx|mjs|cjs|css|html|xml|yaml|yml|toml|ini|log|csv)$/i.test(target);
}

// 根据搜索词生成默认 Bing 搜索 URL.
export function buildSearchUrl(query: string): string {
  return `https://www.bing.com/search?q=${encodeURIComponent(query.trim())}`;
}
