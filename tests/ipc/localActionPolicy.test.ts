import { describe, expect, it } from "vitest";
import {
  isAutoExecutableDesktopMarkdownAction,
  markAutoExecutableDesktopMarkdownAction
} from "../../src/main/ipc/localActionPolicy";
import type { PendingActionDto } from "../../src/shared/ipcTypes";

describe("local action policy", () => {
  it("only auto-executes runtime-generated desktop markdown replies", () => {
    expect(isAutoExecutableDesktopMarkdownAction(markAutoExecutableDesktopMarkdownAction(markdownAction()))).toBe(true);
    expect(isAutoExecutableDesktopMarkdownAction(markdownAction())).toBe(false);
    expect(isAutoExecutableDesktopMarkdownAction(markAutoExecutableDesktopMarkdownAction(markdownAction("Downloads")))).toBe(false);
  });
});

function markdownAction(target = "Desktop/Aiko"): PendingActionDto {
  return {
    title: "写入 回复.md",
    source: "long reply",
    risk: "medium",
    capability: "write_desktop_markdown",
    target,
    params: {
      title: "回复",
      content: "# 内容"
    }
  };
}
