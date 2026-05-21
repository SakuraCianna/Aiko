import { shell } from "electron";

export type ApplicationConfig = {
  name: string;
  aliases: string[];
  path: string;
};

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

function normalize(value: string): string {
  return value.trim().toLowerCase();
}
