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

// 从提醒列表中找出已经到期且仍然激活的提醒.
export function findDueReminders(reminders: Reminder[], now: Date): Reminder[] {
  return reminders.filter((reminder) => {
    return reminder.status === "active" && new Date(reminder.triggerAt).getTime() <= now.getTime();
  });
}
