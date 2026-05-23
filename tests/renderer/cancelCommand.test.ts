import { describe, expect, it } from "vitest";
import { isCancellationCommand } from "../../src/renderer/chat/cancelCommand";

describe("renderer cancellation command", () => {
  it("recognizes short stop commands without sending them to the model", () => {
    expect(isCancellationCommand("中止")).toBe(true);
    expect(isCancellationCommand("停止")).toBe(true);
    expect(isCancellationCommand("别说了")).toBe(true);
    expect(isCancellationCommand("stop")).toBe(true);
  });

  it("does not treat normal requests as cancellation", () => {
    expect(isCancellationCommand("停止录音提醒")).toBe(false);
    expect(isCancellationCommand("帮我总结一下")).toBe(false);
  });
});
