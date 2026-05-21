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
});
