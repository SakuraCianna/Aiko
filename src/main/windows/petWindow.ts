import { app, BrowserWindow, screen } from "electron";
import path from "node:path";
import { PET_WINDOW_SIZE, createPetWindowOptions } from "./petWindowConfig";

// 创建固定尺寸的桌宠主窗口.
export function createPetWindow(preloadPath: string): BrowserWindow {
  const primaryDisplay = screen.getPrimaryDisplay();
  const win = new BrowserWindow(createPetWindowOptions(preloadPath, primaryDisplay.workAreaSize));

  restorePetWindowChrome(win);

  win.on("show", () => console.log("[aiko:window] pet window shown"));
  win.on("hide", () => console.warn("[aiko:window] pet window hidden"));
  win.on("blur", () => {
    console.log("[aiko:window] pet window blurred");
    restorePetWindowChrome(win);
  });
  win.on("focus", () => {
    console.log("[aiko:window] pet window focused");
    restorePetWindowChrome(win);
  });
  win.on("resize", () => enforcePetWindowSize(win));
  win.on("maximize", () => {
    console.warn("[aiko:window] unexpected maximize was reverted");
    win.unmaximize();
    enforcePetWindowSize(win);
  });
  win.once("ready-to-show", () => {
    restorePetWindowChrome(win);
    win.showInactive();
  });
  win.webContents.once("did-finish-load", () => {
    restorePetWindowChrome(win);
    if (!win.isVisible()) win.showInactive();
  });
  win.webContents.on("page-title-updated", (event) => {
    event.preventDefault();
    restorePetWindowChrome(win);
  });

  return win;
}

// 反复恢复桌宠窗口的无标题栏配置, 规避 Windows 透明窗口偶发标题栏回闪.
export function restorePetWindowChrome(win: BrowserWindow) {
  win.setTitle("");
  win.setMenuBarVisibility(false);
  win.removeMenu();
  win.setBackgroundColor("#00000000");
  win.setAlwaysOnTop(true, "screen-saver");
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setIgnoreMouseEvents(false);
  win.setResizable(false);
  win.setMinimizable(false);
  win.setMaximizable(false);
  win.setSkipTaskbar(true);
}

// 强制桌宠窗口保持固定尺寸, 防止拖拽或系统行为意外改变 bounds.
export function enforcePetWindowSize(win: BrowserWindow) {
  const bounds = win.getBounds();
  if (bounds.width === PET_WINDOW_SIZE.width && bounds.height === PET_WINDOW_SIZE.height) return;
  console.warn(
    `[aiko:window] unexpected resize ${bounds.width}x${bounds.height}, restoring ${PET_WINDOW_SIZE.width}x${PET_WINDOW_SIZE.height}`
  );
  win.setBounds({
    x: bounds.x,
    y: bounds.y,
    width: PET_WINDOW_SIZE.width,
    height: PET_WINDOW_SIZE.height
  });
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
