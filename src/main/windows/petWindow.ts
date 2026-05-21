import { app, BrowserWindow, screen } from "electron";
import path from "node:path";
import { createPetWindowOptions } from "./petWindowConfig";

// 创建固定尺寸的桌宠主窗口.
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

// 根据运行环境加载开发服务器或打包后的渲染页.
export function loadRenderer(win: BrowserWindow, dirname: string) {
  const devServerUrl = process.env.ELECTRON_RENDERER_URL;
  if (devServerUrl && !app.isPackaged && isAllowedDevServerUrl(devServerUrl)) {
    void win.loadURL(devServerUrl);
    return;
  }

  void win.loadFile(path.join(dirname, "../renderer/index.html"));
}

// 校验开发服务器 URL 只能指向本机 HTTP 地址.
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
