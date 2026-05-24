import { shell } from "electron";
import { findMatchingApplications } from "./applicationCatalog";

export type ApplicationConfig = {
  name: string;
  aliases: string[];
  path: string;
};

// 根据用户输入匹配应用配置, 并通过 Electron 打开本地程序.
export async function openApplication(apps: ApplicationConfig[], query: string, expectedPath?: string): Promise<boolean> {
  const match = expectedPath
    ? findMatchingApplications(apps, query).find((app) => samePath(app.path, expectedPath))
    : findMatchingApplications(apps, query).at(0);

  if (!match) return false;

  const error = await shell.openPath(match.path);
  return error.length === 0;
}

// Windows 路径比较统一成小写并规整分隔符, 避免大小写差异导致合法授权失效.
function samePath(left: string, right: string): boolean {
  return normalizePath(left) === normalizePath(right);
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/").toLowerCase();
}
