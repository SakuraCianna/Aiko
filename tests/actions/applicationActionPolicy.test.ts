import { describe, expect, it } from "vitest";
import { resolveOpenApplicationAction } from "../../src/main/actions/applicationActionPolicy";
import type { ApplicationConfig } from "../../src/main/capabilities/openApplication";
import type { PendingActionDto } from "../../src/shared/ipcTypes";

const apps: ApplicationConfig[] = [
  { name: "Google Chrome", aliases: ["chrome", "google chrome"], path: "C:\\Chrome\\chrome.exe" },
  { name: "Microsoft Edge", aliases: ["edge", "msedge"], path: "C:\\Edge\\msedge.exe" },
  { name: "Visual Studio Code", aliases: ["VS Code", "vscode", "code"], path: "C:\\Code\\Code.exe" }
];

describe("resolveOpenApplicationAction", () => {
  it("directly resolves a clear application name", () => {
    expect(resolveOpenApplicationAction(appAction("VS Code"), apps)).toEqual({
      kind: "direct",
      action: {
        ...appAction("Visual Studio Code"),
        source: "打开 VS Code",
        target: "Visual Studio Code",
        params: {
          applicationPath: "C:\\Code\\Code.exe"
        }
      }
    });
  });

  it("requires a choice for generic browser requests", () => {
    const result = resolveOpenApplicationAction(appAction("浏览器"), apps);

    expect(result).toEqual({
      kind: "choice_required",
      message: "我找到了几个浏览器. 你选一个, 我再打开.",
      actions: [
        expect.objectContaining({ capability: "open_application", target: "Google Chrome" }),
        expect.objectContaining({ capability: "open_application", target: "Microsoft Edge" })
      ]
    });
  });

  it("uses a remembered default app for generic browser requests", () => {
    const result = resolveOpenApplicationAction(appAction("浏览器"), apps, {
      defaultApplicationTarget: "Microsoft Edge"
    });

    expect(result).toEqual({
      kind: "direct",
      action: {
        ...appAction("Microsoft Edge"),
        source: "打开 浏览器",
        target: "Microsoft Edge",
        params: {
          applicationPath: "C:\\Edge\\msedge.exe"
        }
      }
    });
  });

  it("requires a choice for possessive browser requests", () => {
    const result = resolveOpenApplicationAction(appAction("我的浏览器"), apps);

    expect(result).toMatchObject({
      kind: "choice_required",
      actions: [
        expect.objectContaining({ target: "Google Chrome" }),
        expect.objectContaining({ target: "Microsoft Edge" })
      ]
    });
  });

  it("keeps the original action when no local app matches", () => {
    expect(resolveOpenApplicationAction(appAction("Unknown App"), apps)).toEqual({
      kind: "direct",
      action: appAction("Unknown App")
    });
  });
});

function appAction(target: string): PendingActionDto {
  return {
    title: `打开应用:${target}`,
    source: `打开 ${target}`,
    risk: "low",
    capability: "open_application",
    target
  };
}
