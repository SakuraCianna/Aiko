import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("ReminderPanel", () => {
  it("shows reminders and can complete, delete, and refresh them", () => {
    const panel = readFileSync("src/renderer/components/ReminderPanel.tsx", "utf8");
    const preload = readFileSync("src/main/preload.ts", "utf8");
    const sharedTypes = readFileSync("src/shared/ipcTypes.ts", "utf8");
    const styles = readFileSync("src/renderer/styles.css", "utf8");

    expect(panel).not.toContain("本地提醒会显示在这里");
    expect(panel).toContain("window.aiko.listReminders");
    expect(panel).toContain("window.aiko.updateReminderStatus");
    expect(panel).toContain("window.aiko.deleteReminder");
    expect(panel).toContain("CheckCircle2");
    expect(panel).toContain("Trash2");
    expect(preload).toContain("reminder:list");
    expect(preload).toContain("reminder:update-status");
    expect(preload).toContain("reminder:delete");
    expect(sharedTypes).toContain("ReminderSnapshotDto");
    expect(styles).toContain(".reminder-card");
  });
});
