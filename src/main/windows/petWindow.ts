import { app, BrowserWindow, screen } from "electron";
import path from "node:path";
import { createPetWindowOptions } from "./petWindowConfig";

export function createPetWindow(preloadPath: string): BrowserWindow {
  const primaryDisplay = screen.getPrimaryDisplay();
  const win = new BrowserWindow(createPetWindowOptions(preloadPath, primaryDisplay.workAreaSize));

  win.setAlwaysOnTop(true, "screen-saver");
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setIgnoreMouseEvents(false);
  win.setResizable(false);
  win.setMaximizable(false);

  return win;
}

export function loadRenderer(win: BrowserWindow, dirname: string) {
  const devServerUrl = process.env.ELECTRON_RENDERER_URL;
  if (devServerUrl && !app.isPackaged && isAllowedDevServerUrl(devServerUrl)) {
    void win.loadURL(devServerUrl);
    return;
  }

  void win.loadFile(path.join(dirname, "../renderer/index.html"));
}

export function isAllowedDevServerUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "http:" &&
      (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1")
    );
  } catch {
    return false;
  }
}
