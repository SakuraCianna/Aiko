import { BrowserWindow } from "electron";

export function createPanelWindow(preloadPath: string): BrowserWindow {
  return new BrowserWindow({
    width: 960,
    height: 680,
    show: false,
    title: "",
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
}
