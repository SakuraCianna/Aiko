import { shell } from "electron";

export type ApplicationConfig = {
  name: string;
  aliases: string[];
  path: string;
};

// 根据用户输入匹配应用配置, 并通过 Electron 打开本地程序.
export async function openApplication(apps: ApplicationConfig[], query: string): Promise<boolean> {
  const normalized = normalize(query);
  const match = apps.find((app) => {
    const names = [app.name, ...app.aliases].map(normalize);
    return names.some((name) => name === normalized || name.includes(normalized) || normalized.includes(name));
  });

  if (!match) return false;

  const error = await shell.openPath(match.path);
  return error.length === 0;
}

// 归一化应用名称和别名, 用于宽松匹配.
function normalize(value: string): string {
  return value.trim().toLowerCase();
}
