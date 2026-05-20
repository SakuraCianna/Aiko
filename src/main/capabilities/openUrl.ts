import { shell } from "electron";

export async function openUrl(url: string): Promise<void> {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("Only http and https URLs are supported");
  }
  await shell.openExternal(parsed.toString());
}
