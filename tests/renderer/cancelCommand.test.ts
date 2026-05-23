import { describe, expect, it } from "vitest";
import { isCancellationCommand } from "../../src/renderer/chat/cancelCommand";

describe("renderer cancellation command", () => {
  it("recognizes short stop commands without sending them to the model", () => {
    expect(isCancellationCommand("中止")).toBe(true);
    expect(isCancellationCommand("停止")).toBe(true);
    expect(isCancellationCommand("别说了")).toBe(true);
    expect(isCancellationCommand("stop")).toBe(true);
  });

  it("recognizes natural cancellation intent for the current response", () => {
    expect(isCancellationCommand("先别回答了")).toBe(true);
    expect(isCancellationCommand("不用继续说下去了")).toBe(true);
    expect(isCancellationCommand("停止输出")).toBe(true);
    expect(isCancellationCommand("别再生成了")).toBe(true);
    expect(isCancellationCommand("打住，先停一下")).toBe(true);
    expect(isCancellationCommand("行了可以停了")).toBe(true);
    expect(isCancellationCommand("please stop talking")).toBe(true);
  });

  it("does not treat normal requests as cancellation", () => {
    expect(isCancellationCommand("停止录音提醒")).toBe(false);
    expect(isCancellationCommand("帮我总结一下")).toBe(false);
    expect(isCancellationCommand("怎么停止 Windows 更新")).toBe(false);
    expect(isCancellationCommand("不要停止提醒我喝水")).toBe(false);
    expect(isCancellationCommand("帮我写一个 stop 函数")).toBe(false);
  });
});
