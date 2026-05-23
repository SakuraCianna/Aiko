import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export type DesktopMarkdownWriteRequest = {
  title: string;
  content: string;
};

export type DesktopMarkdownWriteResult = {
  filePath: string;
};

export type DesktopMarkdownWriter = (request: DesktopMarkdownWriteRequest) => Promise<DesktopMarkdownWriteResult>;

type DesktopMarkdownWriterOptions = {
  desktopDir?: string;
  now?: () => Date;
};

const DEFAULT_FILE_TITLE = "Aiko回答";

// 创建写入桌面 Aiko 文件夹的 Markdown writer.
export function createDesktopMarkdownWriter(options: DesktopMarkdownWriterOptions = {}): DesktopMarkdownWriter {
  return async (request) => {
    const now = options.now?.() ?? new Date();
    const title = sanitizeFileTitle(request.title || DEFAULT_FILE_TITLE);
    const desktopDir = options.desktopDir ?? path.join(os.homedir(), "Desktop");
    const folderPath = path.join(desktopDir, "Aiko");
    const filePath = path.join(folderPath, `${formatTimestampForFile(now)}-${title}.md`);

    await fs.mkdir(folderPath, { recursive: true });
    await fs.writeFile(filePath, buildMarkdownDocument(request.content, now), "utf8");

    return { filePath };
  };
}

// 生成写入文件的 Markdown 内容, 在正文前保留生成时间.
function buildMarkdownDocument(content: string, now: Date): string {
  return [`<!-- 生成时间: ${formatTimestampForContent(now)} -->`, content.trim(), ""].join("\n\n");
}

// 生成适合文件名使用的本地时间戳.
function formatTimestampForFile(date: Date): string {
  const year = date.getFullYear();
  const month = pad2(date.getMonth() + 1);
  const day = pad2(date.getDate());
  const hour = pad2(date.getHours());
  const minute = pad2(date.getMinutes());
  const second = pad2(date.getSeconds());
  return `${year}${month}${day}-${hour}${minute}${second}`;
}

// 生成适合 Markdown 阅读的本地时间戳.
function formatTimestampForContent(date: Date): string {
  const year = date.getFullYear();
  const month = pad2(date.getMonth() + 1);
  const day = pad2(date.getDate());
  const hour = pad2(date.getHours());
  const minute = pad2(date.getMinutes());
  const second = pad2(date.getSeconds());
  return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}

// 清理 Windows 文件名非法字符, 避免用户输入破坏路径结构.
function sanitizeFileTitle(title: string): string {
  const sanitized = title.replace(/[<>:"/\\|?*\x00-\x1f]/g, "").trim();
  return sanitized || DEFAULT_FILE_TITLE;
}

// 把数字补成两位字符串.
function pad2(value: number): string {
  return String(value).padStart(2, "0");
}
