import { BrowserWindow } from "electron";

// 创建桌宠的设置和管理面板窗口.
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
