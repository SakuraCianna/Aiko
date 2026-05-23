import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createDesktopMarkdownWriter } from "../../src/main/capabilities/writeDesktopMarkdown";

describe("createDesktopMarkdownWriter", () => {
  it("writes timestamped Aiko markdown files under the desktop Aiko folder", async () => {
    const desktopDir = fs.mkdtempSync(path.join(os.tmpdir(), "aiko-desktop-"));
    const writer = createDesktopMarkdownWriter({
      desktopDir,
      now: () => new Date(2026, 4, 23, 16, 30, 5)
    });

    const result = await writer({
      title: "Aiko回答",
      content: "# 学习规划\n\n先完成核心任务."
    });

    expect(result.filePath).toBe(path.join(desktopDir, "Aiko", "20260523-163005-Aiko回答.md"));
    expect(fs.readFileSync(result.filePath, "utf8")).toContain("生成时间: 2026-05-23 16:30:05");
    expect(fs.readFileSync(result.filePath, "utf8")).toContain("# 学习规划");
  });

  it("sanitizes unsafe title characters before creating the file name", async () => {
    const desktopDir = fs.mkdtempSync(path.join(os.tmpdir(), "aiko-desktop-"));
    const writer = createDesktopMarkdownWriter({
      desktopDir,
      now: () => new Date(2026, 4, 23, 16, 30, 5)
    });

    const result = await writer({
      title: "Aiko:回答/规划?",
      content: "正文"
    });

    expect(path.basename(result.filePath)).toBe("20260523-163005-Aiko回答规划.md");
  });
});
