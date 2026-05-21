import { shell } from "electron";

// 校验并用系统默认浏览器打开 HTTP 或 HTTPS 链接.
export async function openUrl(url: string): Promise<void> {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("Only http and https URLs are supported");
  }
  await shell.openExternal(parsed.toString());
}
