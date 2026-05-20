import { shell } from "electron";

export type ApplicationConfig = {
  name: string;
  aliases: string[];
  path: string;
};

export async function openApplication(apps: ApplicationConfig[], query: string): Promise<boolean> {
  const normalized = query.toLowerCase();
  const match = apps.find((app) => {
    return app.name.toLowerCase() === normalized || app.aliases.some((alias) => alias.toLowerCase() === normalized);
  });

  if (!match) return false;

  const error = await shell.openPath(match.path);
  return error.length === 0;
}
