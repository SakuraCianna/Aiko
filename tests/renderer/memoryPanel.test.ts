import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("MemoryPanel lifecycle", () => {
  it("guards async refreshes after unmount and stale requests", () => {
    const panel = readFileSync("src/renderer/components/MemoryPanel.tsx", "utf8");

    expect(panel).toContain("mountedRef");
    expect(panel).toContain("refreshSeqRef");
    expect(panel).toContain("refreshSeqRef.current === refreshId");
  });
});
