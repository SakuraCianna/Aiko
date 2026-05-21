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

  it("reveals command controls from explicit renderer state or input focus", () => {
    expect(styles).not.toContain(".pet-interaction-zone:hover .hover-controls");
    expect(styles).not.toContain(":has(.character-stage:hover) .hover-controls");
    expect(styles).toContain(".hover-controls.controls-visible");
    expect(styles).toContain("display: none");
  });

  it("keeps the character surface opaque and flush to the top of the transparent window", () => {
    expect(styles).toContain("padding: 0 0 12px");
    expect(styles).toContain("width: 100%");
    expect(styles).toContain("#dce8ef");
    expect(styles).not.toContain("rgba(250, 252, 255, 0.84)");
  });

  it("keeps the fixed pet window from creating browser scrollbars", () => {
    expect(styles).toContain("overflow: hidden");
    expect(styles).toContain("height: calc(100vh - 84px)");
    expect(styles).not.toContain("aspect-ratio: 0.55");
  });

  it("renders replies near the command area instead of recreating a top title bubble", () => {
    const app = readFileSync("src/renderer/App.tsx", "utf8");

    expect(app).toContain("pet-reply");
    expect(styles).toContain(".pet-reply");
    expect(styles).toContain("bottom: 78px");
    expect(styles).not.toContain("top: 12px");
  });
});
