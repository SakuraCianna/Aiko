import { shell } from "electron";
import { findMatchingApplications } from "./applicationCatalog";

export type ApplicationConfig = {
  name: string;
  aliases: string[];
  path: string;
};

// 根据用户输入匹配应用配置, 并通过 Electron 打开本地程序.
export async function openApplication(apps: ApplicationConfig[], query: string): Promise<boolean> {
  const match = findMatchingApplications(apps, query).at(0);

  if (!match) return false;

  const error = await shell.openPath(match.path);
  return error.length === 0;
}
