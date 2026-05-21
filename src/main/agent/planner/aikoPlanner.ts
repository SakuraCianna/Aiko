import type { PendingActionDto } from "../../../shared/ipcTypes";
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

  const openUrlMatch = text.match(/^打开\s+(https?:\/\/\S+)$/i);
  if (openUrlMatch?.[1]) {
    const url = openUrlMatch[1].trim();
    return {
      message: "我可以帮你打开这个网页.",
      action: {
        title: `打开网页:${url}`,
        source: text,
        risk: "low",
        capability: "open_url",
        target: url
      }
    };
  }

  const searchMatch = text.match(/^(?:搜索|搜一下|查一下)\s+(.+)$/);
  if (searchMatch?.[1]) {
    const query = searchMatch[1].trim();
    return {
      message: `我可以帮你搜索:${query}`,
      action: {
        title: `搜索网页:${query}`,
        source: text,
        risk: "low",
        capability: "open_url",
        target: buildSearchUrl(query)
      }
    };
  }

  const openMatch = text.match(/^打开\s+(.+)$/);
  if (openMatch?.[1]) {
    const query = openMatch[1].trim();
    return {
      message: `我可以帮你打开 ${query}.`,
      action: {
        title: `打开应用:${query}`,
        source: text,
        risk: "low",
        capability: "open_application",
        target: query
      }
    };
  }

  const reminderMatch = text.match(/^(\d+)\s*(分钟|小时)后提醒我(.+)$/);
  if (reminderMatch?.[1] && reminderMatch?.[2] && reminderMatch?.[3]) {
    const amount = Number(reminderMatch[1]);
    const unit = reminderMatch[2] === "小时" ? "hours" : "minutes";
    const title = reminderMatch[3].trim();
    return {
      message: `我可以在 ${amount} ${reminderMatch[2]}后提醒你:${title}`,
      action: {
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
      }
    };
  }

  return null;
}

// 根据搜索词生成默认 Bing 搜索 URL.
export function buildSearchUrl(query: string): string {
  return `https://www.bing.com/search?q=${encodeURIComponent(query.trim())}`;
}
