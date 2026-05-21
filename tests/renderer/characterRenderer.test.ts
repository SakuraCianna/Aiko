import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("character renderer migration", () => {
  it("uses the generic CharacterRenderer entry instead of the old Live2D adapter", () => {
    const petStage = readFileSync("src/renderer/components/PetStage.tsx", "utf8");

    expect(petStage).toContain("createCharacterRenderer");
    expect(petStage).toContain("assets/vrm/aiko.vrm");
    expect(petStage).not.toContain("createLive2DAdapter");
    expect(petStage).not.toContain("assets/live2d");
  });

  it("keeps the VRM renderer implementation wired to three-vrm", () => {
    const renderer = readFileSync("src/renderer/character/vrmRenderer.ts", "utf8");

    expect(renderer).toContain("@pixiv/three-vrm");
    expect(renderer).toContain("GLTFLoader");
    expect(renderer).toContain("setMouthOpen");
    expect(renderer).toContain("lookAt");
  });

  it("keeps a fallback renderer for missing VRM assets", () => {
    const factory = readFileSync("src/renderer/character/createCharacterRenderer.ts", "utf8");

    expect(factory).toContain("createVrmCharacterRenderer");
    expect(factory).toContain("createFallbackCharacterRenderer");
  });
});
