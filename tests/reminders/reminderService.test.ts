import { describe, expect, it } from "vitest";
import { createRelativeReminder } from "../../src/main/reminders/reminderService";

describe("createRelativeReminder", () => {
  it("creates a reminder 30 minutes from base time", () => {
    const reminder = createRelativeReminder({
      title: "喝水",
      amount: 30,
      unit: "minutes",
      baseTime: new Date("2026-05-19T10:00:00.000Z")
    });

    expect(reminder.title).toBe("喝水");
    expect(reminder.triggerAt).toBe("2026-05-19T10:30:00.000Z");
    expect(reminder.createdAt).toBe("2026-05-19T10:00:00.000Z");
    expect(reminder.status).toBe("active");
  });
});
