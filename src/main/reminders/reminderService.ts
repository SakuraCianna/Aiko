export type ReminderStatus = "active" | "paused" | "completed" | "cancelled";

export type Reminder = {
  id: string;
  title: string;
  triggerAt: string;
  createdAt: string;
  status: ReminderStatus;
};

export type RelativeReminderInput = {
  title: string;
  amount: number;
  unit: "minutes" | "hours";
  baseTime: Date;
};

export type AbsoluteReminderInput = {
  title: string;
  triggerAt: Date;
  baseTime: Date;
};

// 根据相对时间创建一次性提醒.
export function createRelativeReminder(input: RelativeReminderInput): Reminder {
  const multiplier = input.unit === "hours" ? 60 : 1;
  const triggerAt = new Date(input.baseTime.getTime() + input.amount * multiplier * 60_000);

  return {
    id: `reminder_${crypto.randomUUID()}`,
    title: input.title,
    triggerAt: triggerAt.toISOString(),
    createdAt: input.baseTime.toISOString(),
    status: "active"
  };
}

// 根据绝对时间创建一次性提醒, 供本地解析和模型工具共用.
export function createAbsoluteReminder(input: AbsoluteReminderInput): Reminder {
  return {
    id: `reminder_${crypto.randomUUID()}`,
    title: input.title,
    triggerAt: input.triggerAt.toISOString(),
    createdAt: input.baseTime.toISOString(),
    status: "active"
  };
}
