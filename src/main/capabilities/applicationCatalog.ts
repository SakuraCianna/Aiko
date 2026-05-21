import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import type { ApplicationConfig } from "./openApplication";

const START_MENU_RELATIVE_PATH = path.join("Microsoft", "Windows", "Start Menu", "Programs");
const SHORTCUT_EXTENSION = ".lnk";
const MAX_START_MENU_DEPTH = 4;

// 发现可打开的应用, 包括内置常用应用和开始菜单快捷方式.
export function discoverApplications(env: NodeJS.ProcessEnv = process.env): ApplicationConfig[] {
  return dedupeApplications([...getKnownApplications(env), ...scanStartMenuApplications(env)]);
}

// 根据环境变量构造常见应用的默认路径.
function getKnownApplications(env: NodeJS.ProcessEnv): ApplicationConfig[] {
  const apps: ApplicationConfig[] = [];
  const localAppData = env.LOCALAPPDATA;
  const programFiles = env.ProgramFiles;

  if (localAppData) {
    apps.push({
      name: "Visual Studio Code",
      aliases: ["VS Code", "vscode", "code"],
      path: path.join(localAppData, "Programs", "Microsoft VS Code", "Code.exe")
    });
  }

  if (programFiles) {
    apps.push({
      name: "Google Chrome",
      aliases: ["Chrome", "chrome", "浏览器"],
      path: path.join(programFiles, "Google", "Chrome", "Application", "chrome.exe")
    });
  }

  return apps;
}

// 扫描当前用户和全局开始菜单里的快捷方式.
function scanStartMenuApplications(env: NodeJS.ProcessEnv): ApplicationConfig[] {
  const roots = [env.APPDATA, env.ProgramData]
    .filter((value): value is string => Boolean(value))
    .map((basePath) => path.join(basePath, START_MENU_RELATIVE_PATH));

  return roots.flatMap((root) => scanShortcutDirectory(root, 0));
}

// 递归扫描一个快捷方式目录, 并限制最大深度.
function scanShortcutDirectory(directory: string, depth: number): ApplicationConfig[] {
  if (depth > MAX_START_MENU_DEPTH || !existsSync(directory)) return [];

  try {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) return scanShortcutDirectory(entryPath, depth + 1);
      if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== SHORTCUT_EXTENSION) return [];

      const name = path.basename(entry.name, SHORTCUT_EXTENSION).trim();
      if (!name) return [];
      return [
        {
          name,
          aliases: [name.toLowerCase()],
          path: entryPath
        }
      ];
    });
  } catch {
    return [];
  }
}

// 按路径去重应用配置, 并合并别名.
function dedupeApplications(apps: ApplicationConfig[]): ApplicationConfig[] {
  const byPath = new Map<string, ApplicationConfig>();

  for (const app of apps) {
    const key = app.path.toLowerCase();
    const existing = byPath.get(key);
    if (!existing) {
      byPath.set(key, app);
      continue;
    }

    byPath.set(key, {
      ...existing,
      aliases: [...new Set([...existing.aliases, app.name, ...app.aliases])]
    });
  }

  return [...byPath.values()];
}
