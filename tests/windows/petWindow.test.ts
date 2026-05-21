import { describe, expect, it } from "vitest";
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
});
