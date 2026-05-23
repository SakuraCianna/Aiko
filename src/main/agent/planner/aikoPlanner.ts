import type { PendingActionDto } from "../../../shared/ipcTypes";
import { describePendingAction } from "../../ai/aikoVoice";
import { detectCurrentKnowledgeIntent } from "../knowledge/currentKnowledgeProvider";
import type { AikoPlan, PlannerInput } from "../types";

export type AikoPlanner = {
  plan: (input: PlannerInput) => Promise<AikoPlan>;
};

type DetectedAction = {
  message: string;
  action: PendingActionDto;
};

// 创建 Aiko Planner, 负责把用户输入转换成结构化计划.
export function createAikoPlanner(): AikoPlanner {
  return {
    // 规划一次请求, 先处理确定性本地动作.
    async plan(input) {
      const action = detectFirstDeterministicAction(input.userText, input.userTranscript);
      if (!action) {
        return {
          mode: "chat",
          replyDraft: "",
          steps: [],
          grounding: []
        };
      }

      return {
        mode: "action",
        replyDraft: action.message,
        steps: [
          {
            kind: "action",
            source: "deterministic",
            action: action.action
          }
        ],
        grounding: [
          {
            source: "deterministic_rule",
            note: action.action.capability
          }
        ]
      };
    }
  };
}

// 从文本和语音转写候选中找出第一个确定性动作.
function detectFirstDeterministicAction(userText: string, userTranscript: string): DetectedAction | null {
  const candidates = [userText, ...userTranscript.split("\n")].filter((candidate) => candidate.trim().length > 0);
  for (const candidate of candidates) {
    const action = detectDeterministicAction(candidate);
    if (action) return action;
  }
  return null;
}

// 从用户输入中识别可以本地确定处理的简单动作.
export function detectDeterministicAction(input: string): DetectedAction | null {
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

  return null;
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

// 根据搜索词生成默认 Bing 搜索 URL.
export function buildSearchUrl(query: string): string {
  return `https://www.bing.com/search?q=${encodeURIComponent(query.trim())}`;
}
