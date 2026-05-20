import { BrowserWindow, screen } from "electron";
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
  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL);
    return;
  }

  void win.loadFile(path.join(dirname, "../renderer/index.html"));
}
