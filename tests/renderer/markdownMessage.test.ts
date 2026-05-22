import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("MarkdownMessage", () => {
  it("renders streamed assistant text as a safe Markdown subset", () => {
    const app = readFileSync("src/renderer/App.tsx", "utf8");
    const component = readFileSync("src/renderer/components/MarkdownMessage.tsx", "utf8");
    const styles = readFileSync("src/renderer/styles.css", "utf8");

    expect(app).toContain("<MarkdownMessage content={message} />");
    expect(component).toContain("function parseMarkdownBlocks");
    expect(component).toContain("function renderInline");
    expect(component).toContain("function isSafeLink");
    expect(component).not.toContain("dangerouslySetInnerHTML");
    expect(styles).toContain(".markdown-message");
  });
});
