import { describe, expect, it } from "vitest";
import { createAikoCompanionHeartbeat } from "../../src/main/agent/companion/companionHeartbeat";

function createStateStore(lastCheckInAt: string | null = null) {
  let value = lastCheckInAt;
  return {
    getLastCheckInAt: () => value,
    setLastCheckInAt: (next: string) => {
      value = next;
    }
  };
}

describe("createAikoCompanionHeartbeat", () => {
  it("sends one local companion check-in after the configured interval", async () => {
    const messages: string[] = [];
    const stateStore = createStateStore("2026-05-25T09:00:00.000Z");
    const heartbeat = createAikoCompanionHeartbeat({
      config: {
        enabled: true,
        intervalHours: 24,
        ttsEnabled: false,
        quietStartHour: 23,
        quietEndHour: 8
      },
      stateStore,
      now: () => new Date("2026-05-26T09:05:00.000Z"),
      onDue: (message) => {
        messages.push(message.message);
      }
    });

    await heartbeat.tick();
    await heartbeat.tick();

    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("Aiko");
    expect(stateStore.getLastCheckInAt()).toBe("2026-05-26T09:05:00.000Z");
  });

  it("does not send check-ins during quiet hours or before the interval is due", async () => {
    const messages: string[] = [];
    const stateStore = createStateStore("2026-05-25T09:00:00.000Z");

    await createAikoCompanionHeartbeat({
      config: {
        enabled: true,
        intervalHours: 24,
        ttsEnabled: true,
        quietStartHour: 23,
        quietEndHour: 8
      },
      stateStore,
      now: () => new Date("2026-05-26T23:30:00.000Z"),
      onDue: (message) => {
        messages.push(message.message);
      }
    }).tick();

    await createAikoCompanionHeartbeat({
      config: {
        enabled: true,
        intervalHours: 24,
        ttsEnabled: true,
        quietStartHour: 23,
        quietEndHour: 8
      },
      stateStore,
      now: () => new Date("2026-05-26T07:30:00.000Z"),
      onDue: (message) => {
        messages.push(message.message);
      }
    }).tick();

    await createAikoCompanionHeartbeat({
      config: {
        enabled: true,
        intervalHours: 24,
        ttsEnabled: true,
        quietStartHour: 23,
        quietEndHour: 8
      },
      stateStore: createStateStore("2026-05-26T09:00:00.000Z"),
      now: () => new Date("2026-05-26T12:00:00.000Z"),
      onDue: (message) => {
        messages.push(message.message);
      }
    }).tick();

    expect(messages).toEqual([]);
    expect(stateStore.getLastCheckInAt()).toBe("2026-05-25T09:00:00.000Z");
  });
});
