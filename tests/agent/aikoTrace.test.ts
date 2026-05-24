import { describe, expect, it } from "vitest";
import { createAikoTraceRecorder } from "../../src/main/agent/trace/aikoTrace";

describe("createAikoTraceRecorder", () => {
  it("records request lifecycle events in memory", () => {
    const recorder = createAikoTraceRecorder();
    const trace = recorder.start("request-1");

    trace.add("retriever.completed", { memoryCount: 2 });
    trace.add("planner.completed", { mode: "chat" });
    trace.end({ message: "ok" });

    expect(recorder.list()).toEqual([
      expect.objectContaining({
        requestId: "request-1",
        events: [
          expect.objectContaining({ name: "retriever.completed" }),
          expect.objectContaining({ name: "planner.completed" }),
          expect.objectContaining({ name: "request.completed" })
        ]
      })
    ]);
  });

  it("mirrors trace records and events into a persistent store when configured", () => {
    const storedTraces: unknown[] = [];
    const storedEvents: unknown[] = [];
    const recorder = createAikoTraceRecorder({
      now: (() => {
        const dates = [
          "2026-05-24T10:00:00.000Z",
          "2026-05-24T10:00:01.000Z",
          "2026-05-24T10:00:02.000Z"
        ];
        let index = 0;
        return () => new Date(dates[index++] ?? "2026-05-24T10:00:03.000Z");
      })(),
      store: {
        startTrace(trace) {
          storedTraces.push(trace);
        },
        addTraceEvent(requestId, event) {
          storedEvents.push({ requestId, event });
        },
        endTrace(requestId, endedAt) {
          storedTraces.push({ requestId, endedAt });
        },
        listTraces() {
          return [];
        }
      }
    });

    const trace = recorder.start("request-1");
    trace.add("planner.completed", { mode: "chat" });
    trace.end({ mode: "chat" });

    expect(storedTraces).toEqual([
      {
        requestId: "request-1",
        startedAt: "2026-05-24T10:00:00.000Z"
      },
      {
        requestId: "request-1",
        endedAt: "2026-05-24T10:00:02.000Z"
      }
    ]);
    expect(storedEvents).toEqual([
      {
        requestId: "request-1",
        event: {
          name: "planner.completed",
          at: "2026-05-24T10:00:01.000Z",
          data: { mode: "chat" }
        }
      },
      {
        requestId: "request-1",
        event: {
          name: "request.completed",
          at: "2026-05-24T10:00:02.000Z",
          data: { mode: "chat" }
        }
      }
    ]);
  });
});
