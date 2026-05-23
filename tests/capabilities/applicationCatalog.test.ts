import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  discoverApplications,
  findBrowserApplications,
  findMatchingApplications,
  isGenericBrowserQuery
} from "../../src/main/capabilities/applicationCatalog";

describe("discoverApplications", () => {
  it("includes known applications and start menu shortcuts", () => {
    const appData = mkdtempSync(path.join(tmpdir(), "aiko-appdata-"));
    const localAppData = mkdtempSync(path.join(tmpdir(), "aiko-localappdata-"));
    const programFiles = mkdtempSync(path.join(tmpdir(), "aiko-programfiles-"));
    const startMenu = path.join(appData, "Microsoft", "Windows", "Start Menu", "Programs", "Tools");
    mkdirSync(startMenu, { recursive: true });
    writeFileSync(path.join(startMenu, "My Tool.lnk"), "");
    touch(path.join(localAppData, "Programs", "Microsoft VS Code", "Code.exe"));
    touch(path.join(programFiles, "Google", "Chrome", "Application", "chrome.exe"));
    touch(path.join(programFiles, "Microsoft", "Edge", "Application", "msedge.exe"));
    touch(path.join(programFiles, "Mozilla Firefox", "firefox.exe"));
    touch(path.join(programFiles, "BraveSoftware", "Brave-Browser", "Application", "brave.exe"));

    const apps = discoverApplications({
      APPDATA: appData,
      LOCALAPPDATA: localAppData,
      ProgramFiles: programFiles
    });

    expect(apps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Visual Studio Code" }),
        expect.objectContaining({ name: "Google Chrome" }),
        expect.objectContaining({ name: "Microsoft Edge" }),
        expect.objectContaining({ name: "Mozilla Firefox" }),
        expect.objectContaining({ name: "Brave" }),
        expect.objectContaining({ name: "My Tool", path: expect.stringContaining("My Tool.lnk") })
      ])
    );
  });

  it("does not offer known applications when their executable paths are missing", () => {
    const programFiles = mkdtempSync(path.join(tmpdir(), "aiko-empty-programfiles-"));

    const apps = discoverApplications({
      ProgramFiles: programFiles
    });

    expect(apps).toEqual([]);
  });

  it("treats generic browser requests as a browser choice instead of a fixed app", () => {
    const apps = [
      { name: "Google Chrome", aliases: ["chrome", "google chrome"], path: "C:\\Chrome\\chrome.exe" },
      { name: "Microsoft Edge", aliases: ["edge", "msedge"], path: "C:\\Edge\\msedge.exe" },
      { name: "Visual Studio Code", aliases: ["vscode", "code"], path: "C:\\Code\\Code.exe" }
    ];

    expect(isGenericBrowserQuery("浏览器")).toBe(true);
    expect(isGenericBrowserQuery("我的浏览器")).toBe(true);
    expect(isGenericBrowserQuery("默认浏览器")).toBe(true);
    expect(isGenericBrowserQuery("Chrome")).toBe(false);
    expect(isGenericBrowserQuery("谷歌浏览器")).toBe(false);
    expect(findBrowserApplications(apps).map((app) => app.name)).toEqual(["Google Chrome", "Microsoft Edge"]);
  });

  it("deduplicates browser candidates that come from both known paths and shortcuts", () => {
    const apps = [
      { name: "Google Chrome", aliases: ["chrome", "google chrome"], path: "C:\\Chrome\\chrome.exe" },
      { name: "Google Chrome", aliases: ["google chrome"], path: "C:\\Start Menu\\Google Chrome.lnk" },
      { name: "Microsoft Edge", aliases: ["edge", "msedge"], path: "C:\\Edge\\msedge.exe" },
      { name: "Microsoft Edge", aliases: ["microsoft edge"], path: "C:\\Start Menu\\Microsoft Edge.lnk" }
    ];

    expect(findBrowserApplications(apps).map((app) => app.name)).toEqual(["Google Chrome", "Microsoft Edge"]);
  });

  it("finds exact application matches without treating browser brands as ambiguous", () => {
    const apps = [
      { name: "Google Chrome", aliases: ["chrome", "google chrome"], path: "C:\\Chrome\\chrome.exe" },
      { name: "Microsoft Edge", aliases: ["edge", "msedge"], path: "C:\\Edge\\msedge.exe" },
      { name: "Visual Studio Code", aliases: ["VS Code", "vscode", "code"], path: "C:\\Code\\Code.exe" }
    ];

    expect(findMatchingApplications(apps, "VS Code").map((app) => app.name)).toEqual(["Visual Studio Code"]);
    expect(findMatchingApplications(apps, "Chrome").map((app) => app.name)).toEqual(["Google Chrome"]);
  });
});

function touch(filePath: string) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, "");
}
