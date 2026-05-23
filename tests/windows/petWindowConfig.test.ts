import { describe, expect, it } from "vitest";
import { PET_WINDOW_SIZE, createPetWindowOptions } from "../../src/main/windows/petWindowConfig";

describe("petWindowConfig", () => {
  it("uses a fixed, titleless desktop pet window size", () => {
    expect(PET_WINDOW_SIZE).toEqual({ width: 320, height: 560 });

    const options = createPetWindowOptions("preload.js", { width: 1920, height: 1080 });

    expect(options).toMatchObject({
      width: 320,
      height: 560,
      minWidth: 320,
      maxWidth: 320,
      minHeight: 560,
      maxHeight: 560,
      show: false,
      title: "",
      frame: false,
      transparent: true,
      backgroundColor: "#00000000",
      thickFrame: false,
      autoHideMenuBar: true,
      resizable: false,
      movable: true,
      minimizable: false,
      maximizable: false,
      fullscreenable: false
    });
    expect(options).not.toHaveProperty("titleBarStyle");
    expect(options).not.toHaveProperty("titleBarOverlay");
    expect(options.skipTaskbar).toBe(true);
  });
});
