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
    expect(petWindow).toContain("restorePetWindowChrome");
    expect(petWindow).toContain("page-title-updated");
    expect(petWindow).toContain("showInactive");
    expect(petWindow).toContain("setMinimizable(false)");
    expect(petWindow).toContain("setMenuBarVisibility(false)");
    expect(petWindow).toContain("enforcePetWindowSize");
    expect(petWindow).toContain("setBackgroundColor(\"#00000000\")");
    expect(petWindow).toContain("setWindowOpenHandler");
  });

  it("sets a renderer content security policy without unsafe eval", () => {
    const devHtml = readFileSync("index.html", "utf8");
    const packagedHtml = readFileSync("src/renderer/index.html", "utf8");

    for (const html of [devHtml, packagedHtml]) {
      expect(html).toContain("Content-Security-Policy");
      expect(html).toContain("default-src 'self'");
      expect(html).toContain("connect-src 'self' blob: data:");
      expect(html).not.toContain("unsafe-eval");
    }
  });
});
