import path from "node:path";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { resolvePreloadPath } from "../../src/main/windows/preloadPath";

describe("resolvePreloadPath", () => {
  it("points Electron at the preload bundle emitted by electron-vite", () => {
    expect(resolvePreloadPath("E:/CodeHome/Aiko/out/main")).toBe(
      path.join("E:/CodeHome/Aiko/out/main", "../preload/preload.cjs")
    );
  });

  it("keeps the preload bundle in CommonJS for Electron sandbox preload", () => {
    const config = readFileSync("electron.vite.config.ts", "utf8");

    expect(config).toContain("format: \"cjs\"");
    expect(config).toContain("entryFileNames: \"preload.cjs\"");
  });
});
