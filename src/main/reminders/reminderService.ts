export type Reminder = {
  id: string;
  title: string;
  triggerAt: string;
  status: "active" | "paused" | "completed";
};

export type RelativeReminderInput = {
  title: string;
  amount: number;
  unit: "minutes";
  baseTime: Date;
};

export function createRelativeReminder(input: RelativeReminderInput): Reminder {
  const triggerAt = new Date(input.baseTime.getTime() + input.amount * 60_000);

  return {
    id: `reminder_${crypto.randomUUID()}`,
    title: input.title,
    triggerAt: triggerAt.toISOString(),
    status: "active"
  };
}

export function findDueReminders(reminders: Reminder[], now: Date): Reminder[] {
  return reminders.filter((reminder) => {
    return reminder.status === "active" && new Date(reminder.triggerAt).getTime() <= now.getTime();
  });
}
