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
      title: "",
      frame: false,
      transparent: true,
      resizable: false,
      maximizable: false,
      fullscreenable: false
    });
  });
});
