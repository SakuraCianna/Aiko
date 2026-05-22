import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("character renderer migration", () => {
  it("uses the generic CharacterRenderer entry instead of the old Live2D adapter", () => {
    const petStage = readFileSync("src/renderer/components/PetStage.tsx", "utf8");

    expect(petStage).toContain("createCharacterRenderer");
    expect(petStage).toContain("assets/vrm/Aiko.vrm");
    expect(petStage).not.toContain("createLive2DAdapter");
    expect(petStage).not.toContain("assets/live2d");
  });

  it("keeps the VRM renderer implementation wired to three-vrm", () => {
    const renderer = readFileSync("src/renderer/character/vrmRenderer.ts", "utf8");

    expect(renderer).toContain("@pixiv/three-vrm");
    expect(renderer).toContain("GLTFLoader");
    expect(renderer).toContain("camera.lookAt(0, 0.02, 0)");
    expect(renderer).toContain("VRMUtils.rotateVRM0(vrm)");
    expect(renderer).toContain("powerPreference: \"high-performance\"");
    expect(renderer).toContain("Math.min(window.devicePixelRatio, 3)");
    expect(renderer).toContain("setMouthOpen");
    expect(renderer).toContain("lookAt");
  });

  it("does not double-mount VRM through React StrictMode in development", () => {
    const main = readFileSync("src/renderer/main.tsx", "utf8");

    expect(main).not.toContain("StrictMode");
  });

  it("keeps a fallback renderer for missing VRM assets", () => {
    const factory = readFileSync("src/renderer/character/createCharacterRenderer.ts", "utf8");

    expect(factory).toContain("createVrmCharacterRenderer");
    expect(factory).toContain("createFallbackCharacterRenderer");
  });

  it("uses the downloaded Aiko VRM asset as the default character model", () => {
    const petStage = readFileSync("src/renderer/components/PetStage.tsx", "utf8");
    const viteConfig = readFileSync("electron.vite.config.ts", "utf8");

    expect(petStage).toContain("assets/vrm/Aiko.vrm");
    expect(viteConfig).toContain("copyRendererAssetsPlugin");
    expect(viteConfig).toContain("out/renderer/assets");
  });

  it("guards asynchronous character mounting after destroy", () => {
    const factory = readFileSync("src/renderer/character/createCharacterRenderer.ts", "utf8");
    const vrmRenderer = readFileSync("src/renderer/character/vrmRenderer.ts", "utf8");

    expect(factory).toContain("destroyed");
    expect(factory).toContain("if (destroyed) return");
    expect(vrmRenderer).toContain("if (destroyed)");
    expect(vrmRenderer).toContain("VRMUtils.deepDispose(loadedVrm.scene)");
  });
});
