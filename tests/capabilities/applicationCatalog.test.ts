import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { discoverApplications } from "../../src/main/capabilities/applicationCatalog";

describe("discoverApplications", () => {
  it("includes known applications and start menu shortcuts", () => {
    const appData = mkdtempSync(path.join(tmpdir(), "aiko-appdata-"));
    const startMenu = path.join(appData, "Microsoft", "Windows", "Start Menu", "Programs", "Tools");
    mkdirSync(startMenu, { recursive: true });
    writeFileSync(path.join(startMenu, "My Tool.lnk"), "");

    const apps = discoverApplications({
      APPDATA: appData,
      LOCALAPPDATA: "C:\\Users\\aiko\\AppData\\Local",
      ProgramFiles: "C:\\Program Files"
    });

    expect(apps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Visual Studio Code" }),
        expect.objectContaining({ name: "Google Chrome" }),
        expect.objectContaining({ name: "My Tool", path: expect.stringContaining("My Tool.lnk") })
      ])
    );
  });
});
