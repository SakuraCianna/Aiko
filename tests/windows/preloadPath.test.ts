import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolvePreloadPath } from "../../src/main/windows/preloadPath";

describe("resolvePreloadPath", () => {
  it("points Electron at the preload bundle emitted by electron-vite", () => {
    expect(resolvePreloadPath("E:/CodeHome/Aiko/out/main")).toBe(
      path.join("E:/CodeHome/Aiko/out/main", "../preload/preload.mjs")
    );
  });
});
