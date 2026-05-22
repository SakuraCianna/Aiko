import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { isAllowedDevServerUrl } from "../../src/main/windows/petWindow";

describe("isAllowedDevServerUrl", () => {
  it("allows local HTTP dev server URLs", () => {
    expect(isAllowedDevServerUrl("http://localhost:5173")).toBe(true);
    expect(isAllowedDevServerUrl("http://127.0.0.1:5173")).toBe(true);
  });

  it("rejects remote, https, and invalid renderer URLs", () => {
    expect(isAllowedDevServerUrl("https://localhost:5173")).toBe(false);
    expect(isAllowedDevServerUrl("http://example.com")).toBe(false);
    expect(isAllowedDevServerUrl("not-a-url")).toBe(false);
  });

  it("configures isolated development session cache and renderer diagnostics", () => {
    const mainEntry = readFileSync("src/main/index.ts", "utf8");
    const petWindow = readFileSync("src/main/windows/petWindow.ts", "utf8");

    expect(mainEntry).toContain("setPath(\"sessionData\"");
    expect(mainEntry).toContain("attachRendererDiagnostics");
    expect(petWindow).toContain("setMinimizable(false)");
    expect(petWindow).toContain("setMenuBarVisibility(false)");
    expect(petWindow).toContain("enforcePetWindowSize");
    expect(petWindow).toContain("setBackgroundColor(\"#00000000\")");
  });
});
