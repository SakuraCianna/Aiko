import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("SettingsPanel", () => {
  it("loads and renders ASR/TTS provider status", () => {
    const settingsPanel = readFileSync("src/renderer/components/SettingsPanel.tsx", "utf8");

    expect(settingsPanel).toContain("getVoiceStatus");
    expect(settingsPanel).toContain("tencent-cloud");
    expect(settingsPanel).toContain("腾讯云");
    expect(settingsPanel).toContain("voice-status");
    expect(readFileSync("src/renderer/styles.css", "utf8")).toContain(".voice-status-row");
  });
});
