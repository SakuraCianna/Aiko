import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const styles = readFileSync("src/renderer/styles.css", "utf8");

describe("renderer layout CSS", () => {
  it("does not keep the old top speech bubble styling in the pet window", () => {
    expect(styles).not.toContain("speech-bubble");
  });

  it("anchors hover controls to the bottom of the fixed pet window", () => {
    expect(styles).toContain(".hover-controls");
    expect(styles).toContain("position: fixed");
    expect(styles).toContain("bottom: 12px");
  });

  it("keeps the command input compact for the pet window", () => {
    expect(styles).toMatch(/\.command-input\s*\{[\s\S]*gap:\s*6px;/);
    expect(styles).toMatch(/\.command-input\s*\{[\s\S]*padding:\s*7px 8px;/);
    expect(styles).toMatch(/\.command-input\s*\{[\s\S]*border-radius:\s*8px;/);
    expect(styles).toMatch(/\.command-input input\s*\{[\s\S]*font-size:\s*14px;/);
    expect(styles).toMatch(/\.command-input button\s*\{[\s\S]*width:\s*34px;/);
    expect(styles).toMatch(/\.command-input button\s*\{[\s\S]*min-height:\s*34px;/);
    expect(styles).toMatch(/\.command-input button svg\s*\{[\s\S]*width:\s*18px;/);
  });

  it("reveals command controls from explicit renderer state or input focus", () => {
    expect(styles).not.toContain(".pet-interaction-zone:hover .hover-controls");
    expect(styles).not.toContain(":has(.character-stage:hover) .hover-controls");
    expect(styles).toContain(".hover-controls.controls-visible");
    expect(styles).toContain("display: none");
  });

  it("keeps the character surface transparent and uses native window dragging", () => {
    const petStage = readFileSync("src/renderer/components/PetStage.tsx", "utf8");

    expect(styles).toContain("padding: 0 0 12px");
    expect(styles).toContain("width: 100%");
    expect(styles).toContain("cursor: grab");
    expect(styles).toContain("box-shadow: none");
    expect(styles).toMatch(/\.character-stage\s*\{[\s\S]*-webkit-app-region:\s*drag;/);
    expect(styles).toMatch(/\.pet-toolbar\s*\{[\s\S]*-webkit-app-region:\s*no-drag;/);
    expect(styles).toMatch(/\.hover-controls\s*\{[\s\S]*-webkit-app-region:\s*no-drag;/);
    expect(styles).not.toContain("#dce8ef");
    expect(styles).not.toContain("rgba(250, 252, 255, 0.84)");
    expect(petStage).not.toContain("startWindowDrag");
    expect(petStage).not.toContain("moveWindowDrag");
    expect(petStage).not.toContain("setPointerCapture");
    expect(petStage).not.toContain("draggingRef");
  });

  it("keeps the fixed pet window from creating browser scrollbars", () => {
    expect(styles).toContain("overflow: hidden");
    expect(styles).toContain("height: calc(100vh - 84px)");
    expect(styles).not.toContain("aspect-ratio: 0.55");
  });

  it("replaces the visible reply bubble with voice output", () => {
    const app = readFileSync("src/renderer/App.tsx", "utf8");

    expect(app).toContain("createAikoSpeechController");
    expect(app).toContain("speakAiko");
    expect(app).not.toContain("className=\"pet-reply\"");
    expect(app).not.toContain("<MarkdownMessage content={message} />");
    expect(styles).not.toContain("top: 12px");
  });

  it("guards stream completion so stale responses cannot overwrite newer requests", () => {
    const app = readFileSync("src/renderer/App.tsx", "utf8");

    expect(app).toContain("isActiveRequest");
    expect(app).toContain("if (!isActiveRequest(requestId)) return");
  });

  it("preserves pending action choices so generic app requests show selectable apps", () => {
    const app = readFileSync("src/renderer/App.tsx", "utf8");
    const dialog = readFileSync("src/renderer/components/ConfirmDialog.tsx", "utf8");

    expect(app).toContain("choices: response.pendingAction.choices");
    expect(app).toContain("onChoose={(action) => void executePendingAction(false, action)}");
    expect(app).toContain("onChooseDefault={(action) => void executePendingAction(true, action)}");
    expect(dialog).toContain("将此设定为默认选项");
  });

  it("cleans renderer timers when the app unmounts", () => {
    const app = readFileSync("src/renderer/App.tsx", "utf8");

    expect(app).toContain("clearHideControlsTimer");
    expect(app).toContain("unsubscribeStreamDeltas");
  });
});
