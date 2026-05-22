import type { BrowserWindowConstructorOptions } from "electron";

export const PET_WINDOW_SIZE = {
  width: 320,
  height: 560
} as const;

type WorkAreaSize = {
  width: number;
  height: number;
};

// 根据屏幕工作区创建桌宠窗口配置.
export function createPetWindowOptions(
  preloadPath: string,
  workAreaSize: WorkAreaSize
): BrowserWindowConstructorOptions {
  return {
    width: PET_WINDOW_SIZE.width,
    height: PET_WINDOW_SIZE.height,
    minWidth: PET_WINDOW_SIZE.width,
    maxWidth: PET_WINDOW_SIZE.width,
    minHeight: PET_WINDOW_SIZE.height,
    maxHeight: PET_WINDOW_SIZE.height,
    x: Math.max(0, workAreaSize.width - PET_WINDOW_SIZE.width - 70),
    y: Math.max(0, workAreaSize.height - PET_WINDOW_SIZE.height - 80),
    title: "",
    transparent: true,
    backgroundColor: "#00000000",
    frame: false,
    thickFrame: false,
    autoHideMenuBar: true,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  };
}
