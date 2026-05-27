import type { AppConfig } from "../../config/env";
import type { AikoProactiveMessage } from "../../../shared/ipcTypes";

export type CompanionHeartbeatStateStore = {
  getLastCheckInAt: () => string | null;
  setLastCheckInAt: (value: string) => void;
};

type CompanionHeartbeatOptions = {
  config: AppConfig["companion"];
  stateStore: CompanionHeartbeatStateStore;
  now?: () => Date;
  onDue: (message: AikoProactiveMessage) => void | Promise<void>;
};

// 创建主动陪伴心跳, 用本地规则每天轻量关心一次, 不消耗模型调用.
export function createAikoCompanionHeartbeat(options: CompanionHeartbeatOptions) {
  const now = options.now ?? (() => new Date());
  let tickInFlight = false;

  return {
    // 检查是否到了主动关心时间, 命中后发送 renderer 可展示的主动消息.
    async tick() {
      if (tickInFlight || !options.config.enabled) return;
      tickInFlight = true;
      try {
        const currentTime = now();
        if (isQuietHour(currentTime, options.config)) return;
        if (!isIntervalDue(options.stateStore.getLastCheckInAt(), currentTime, options.config.intervalHours)) return;

        const message = createCompanionCheckInMessage(currentTime, options.config.ttsEnabled);
        await options.onDue(message);
        options.stateStore.setLastCheckInAt(currentTime.toISOString());
      } finally {
        tickInFlight = false;
      }
    }
  };
}

// 按本地时间生成陪伴语气, 避免为了简单问候调用大模型.
function createCompanionCheckInMessage(now: Date, shouldSpeak: boolean): AikoProactiveMessage {
  const hour = now.getHours();
  const message = selectCompanionMessage(hour);
  const createdAt = now.toISOString();
  return {
    id: `companion_${createdAt}`,
    kind: "companion_checkin",
    message,
    createdAt,
    shouldSpeak,
    tone: "gentle"
  };
}

// 判断距离上次主动关心是否已经超过配置间隔.
function isIntervalDue(lastCheckInAt: string | null, now: Date, intervalHours: number) {
  if (!lastCheckInAt) return true;
  const previous = Date.parse(lastCheckInAt);
  if (!Number.isFinite(previous)) return true;
  return now.getTime() - previous >= intervalHours * 60 * 60 * 1000;
}

// 判断当前小时是否处于安静时段, 支持跨午夜区间.
function isQuietHour(now: Date, config: AppConfig["companion"]) {
  const hour = now.getHours();
  const start = config.quietStartHour;
  const end = config.quietEndHour;
  if (start === end) return false;
  if (start < end) return hour >= start && hour < end;
  return hour >= start || hour < end;
}

// 根据一天中的时间给 Aiko 一个自然但克制的主动出现文本.
function selectCompanionMessage(hour: number) {
  if (hour < 11) return "Aiko 过来轻轻看一眼. 早上如果要整理今天的节奏, 我可以陪你把事情排清楚.";
  if (hour < 14) return "Aiko 在旁边待命. 中午如果脑子有点散, 我可以帮你把下午要做的事捋一下.";
  if (hour < 18) return "Aiko 稍微探头. 现在要不要检查一下进度, 或者把卡住的任务拆小一点?";
  if (hour < 23) return "Aiko 还在桌面边上. 晚上适合收束一下, 需要我帮你整理今天的尾巴吗?";
  return "Aiko 轻声提醒一下. 已经很晚了, 如果还要继续, 我可以帮你把下一步缩到最小.";
}
