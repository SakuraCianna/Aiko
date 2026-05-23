import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import type { ApplicationConfig } from "./openApplication";

const START_MENU_RELATIVE_PATH = path.join("Microsoft", "Windows", "Start Menu", "Programs");
const SHORTCUT_EXTENSION = ".lnk";
const MAX_START_MENU_DEPTH = 4;
const GENERIC_BROWSER_QUERIES = new Set(["browser", "browsers", "webbrowser", "web browser", "浏览器", "网页浏览器"]);
const BROWSER_KEYWORDS = [
  "chrome",
  "google chrome",
  "msedge",
  "microsoft edge",
  "edge",
  "firefox",
  "mozilla firefox",
  "brave",
  "brave browser",
  "opera",
  "谷歌浏览器",
  "谷歌",
  "火狐",
  "火狐浏览器",
  "浏览器"
];

// 发现可打开的应用, 包括内置常用应用和开始菜单快捷方式.
export function discoverApplications(env: NodeJS.ProcessEnv = process.env): ApplicationConfig[] {
  return dedupeApplications([...getKnownApplications(env), ...scanStartMenuApplications(env)]);
}

// 根据环境变量构造常见应用的默认路径.
function getKnownApplications(env: NodeJS.ProcessEnv): ApplicationConfig[] {
  const apps: ApplicationConfig[] = [];
  const localAppData = env.LOCALAPPDATA;
  const programFiles = env.ProgramFiles;
  const programFilesX86 = env["ProgramFiles(x86)"];

  if (localAppData) {
    addKnownApplication(apps, {
      name: "Visual Studio Code",
      aliases: ["VS Code", "vscode", "code"],
      path: path.join(localAppData, "Programs", "Microsoft VS Code", "Code.exe")
    });
  }

  if (programFiles) {
    addKnownApplication(apps, {
      name: "Google Chrome",
      aliases: ["Chrome", "chrome", "谷歌浏览器", "谷歌", "google", "google chrome"],
      path: path.join(programFiles, "Google", "Chrome", "Application", "chrome.exe")
    });
    addKnownApplication(apps, {
      name: "Microsoft Edge",
      aliases: ["Edge", "edge", "msedge", "Microsoft Edge", "microsoft edge"],
      path: path.join(programFiles, "Microsoft", "Edge", "Application", "msedge.exe")
    });
    addKnownApplication(apps, {
      name: "Mozilla Firefox",
      aliases: ["Firefox", "firefox", "Mozilla Firefox", "mozilla firefox", "火狐", "火狐浏览器"],
      path: path.join(programFiles, "Mozilla Firefox", "firefox.exe")
    });
    addKnownApplication(apps, {
      name: "Brave",
      aliases: ["Brave", "brave", "Brave Browser", "brave browser"],
      path: path.join(programFiles, "BraveSoftware", "Brave-Browser", "Application", "brave.exe")
    });
  }

  if (programFilesX86) {
    addKnownApplication(apps, {
      name: "Microsoft Edge",
      aliases: ["Edge", "edge", "msedge", "Microsoft Edge", "microsoft edge"],
      path: path.join(programFilesX86, "Microsoft", "Edge", "Application", "msedge.exe")
    });
    addKnownApplication(apps, {
      name: "Mozilla Firefox",
      aliases: ["Firefox", "firefox", "Mozilla Firefox", "mozilla firefox", "火狐", "火狐浏览器"],
      path: path.join(programFilesX86, "Mozilla Firefox", "firefox.exe")
    });
  }

  return apps;
}

// 只收录真实存在的常见应用路径, 避免给用户展示未安装的候选.
function addKnownApplication(apps: ApplicationConfig[], app: ApplicationConfig) {
  if (existsSync(app.path)) apps.push(app);
}

// 判断用户是否只是泛称浏览器, 这种情况需要让用户从本机候选里选择.
export function isGenericBrowserQuery(query: string): boolean {
  return GENERIC_BROWSER_QUERIES.has(normalizeGenericBrowserQuery(query));
}

// 从应用列表中过滤浏览器候选, 用于处理"打开浏览器"这类泛称请求.
export function findBrowserApplications(apps: ApplicationConfig[]): ApplicationConfig[] {
  const browserApps = apps.filter((app) => {
    const names = [app.name, ...app.aliases].map(normalizeApplicationName);
    return names.some((name) => BROWSER_KEYWORDS.some((keyword) => name === normalizeApplicationName(keyword)));
  });
  return dedupeApplicationsByName(browserApps);
}

// 根据用户输入寻找本地应用, 精确匹配优先, 其次才使用包含关系.
export function findMatchingApplications(apps: ApplicationConfig[], query: string): ApplicationConfig[] {
  const normalizedQuery = normalizeApplicationName(query);
  if (!normalizedQuery) return [];

  const exactMatches = apps.filter((app) => {
    const names = [app.name, ...app.aliases].map(normalizeApplicationName);
    return names.some((name) => name === normalizedQuery);
  });
  if (exactMatches.length > 0) return exactMatches;

  return apps.filter((app) => {
    const names = [app.name, ...app.aliases].map(normalizeApplicationName);
    return names.some((name) => name.includes(normalizedQuery) || normalizedQuery.includes(name));
  });
}

// 归一化应用名和别名, 让中英文输入都能稳定匹配.
export function normalizeApplicationName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[。？！；：,.!?;:]+$/g, "")
    .replace(/\s+/g, " ");
}

// 归一化浏览器泛称, 支持"我的浏览器"和"默认浏览器"这类自然说法.
function normalizeGenericBrowserQuery(value: string): string {
  const spaced = normalizeApplicationName(value)
    .replace(/^(my|default|a|an|the)\s+/i, "")
    .replace(/\s+(app|application|software)$/i, "");
  return spaced
    .replace(/\s+/g, "")
    .replace(/^(我的默认|我自己的|我常用的|系统默认的|默认的|我的|默认|常用的|常用|一个|一款|这个|那个)/, "")
    .replace(/(软件|应用|程序)$/, "");
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

// 按应用显示名去重候选, 避免 exe 和开始菜单快捷方式重复展示.
function dedupeApplicationsByName(apps: ApplicationConfig[]): ApplicationConfig[] {
  const byName = new Map<string, ApplicationConfig>();

  for (const app of apps) {
    const key = normalizeApplicationName(app.name);
    const existing = byName.get(key);
    if (!existing) {
      byName.set(key, app);
      continue;
    }

    byName.set(key, {
      ...existing,
      aliases: [...new Set([...existing.aliases, app.name, ...app.aliases])]
    });
  }

  return [...byName.values()];
}
