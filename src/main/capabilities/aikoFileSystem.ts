import { mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export type AikoDirectoryEntry = {
  name: string;
  path: string;
  kind: "file" | "directory" | "other";
};

export type AikoFileTrashResult = {
  originalPath: string;
  trashPath: string;
};

export type AikoFileSystem = {
  readTextFile: (filePath: string, maxBytes?: number) => Promise<string>;
  writeTextFile: (filePath: string, content: string, options: { overwrite: boolean }) => Promise<void>;
  listDirectory: (directoryPath: string, limit?: number) => Promise<AikoDirectoryEntry[]>;
  moveToTrash: (filePath: string) => Promise<AikoFileTrashResult>;
};

export type AikoFileSystemOptions = {
  allowedRoots?: string[];
  trashDir?: string;
};

const DEFAULT_MAX_READ_BYTES = 256 * 1024;
const DEFAULT_LIST_LIMIT = 200;
const SENSITIVE_FILE_NAMES = new Set([".env", ".env.local", ".npmrc", "id_rsa", "id_ed25519"]);

// 创建 Aiko 的受控文件系统能力, 所有路径必须落在允许根目录内.
export function createAikoFileSystem(options: AikoFileSystemOptions = {}): AikoFileSystem {
  const allowedRoots = normalizeAllowedRoots(options.allowedRoots ?? createDefaultAllowedRoots());
  const trashDir = path.resolve(options.trashDir ?? path.join(os.homedir(), "Desktop", "Aiko", ".trash"));

  return {
    // 读取 UTF-8 文本文件, 并限制最大读取体积.
    async readTextFile(filePath, maxBytes = DEFAULT_MAX_READ_BYTES) {
      const resolved = assertAllowedFilePath(filePath, allowedRoots);
      assertNotSensitivePath(resolved);
      const fileStats = await stat(resolved);
      if (!fileStats.isFile()) throw new Error("path is not a file");
      if (fileStats.size > maxBytes) throw new Error("file is too large");
      return readFile(resolved, "utf8");
    },

    // 写入 UTF-8 文本文件, 默认不覆盖已有文件.
    async writeTextFile(filePath, content, options) {
      const resolved = assertAllowedFilePath(filePath, allowedRoots);
      assertNotSensitivePath(resolved);
      await mkdir(path.dirname(resolved), { recursive: true });
      await writeFile(resolved, content, { encoding: "utf8", flag: options.overwrite ? "w" : "wx" });
    },

    // 列出目录内容, 用固定数量上限防止一次性展开过大目录.
    async listDirectory(directoryPath, limit = DEFAULT_LIST_LIMIT) {
      const resolved = assertAllowedFilePath(directoryPath, allowedRoots);
      const entries = await readdir(resolved, { withFileTypes: true });
      return entries.slice(0, Math.max(1, Math.min(limit, DEFAULT_LIST_LIMIT))).map((entry) => ({
        name: entry.name,
        path: path.join(resolved, entry.name),
        kind: entry.isDirectory() ? "directory" : entry.isFile() ? "file" : "other"
      }));
    },

    // 删除文件时移动到 Aiko trash 目录, 避免直接永久删除用户数据.
    async moveToTrash(filePath) {
      const resolved = assertAllowedFilePath(filePath, allowedRoots);
      assertNotSensitivePath(resolved);
      const fileStats = await stat(resolved);
      if (!fileStats.isFile()) throw new Error("path is not a file");
      await mkdir(trashDir, { recursive: true });
      const trashPath = path.join(trashDir, `${formatTimestamp(new Date())}-${path.basename(resolved)}`);
      await rename(resolved, trashPath);
      return { originalPath: resolved, trashPath };
    }
  };
}

// 默认允许用户常用目录和当前项目目录, 不开放整个系统盘.
function createDefaultAllowedRoots() {
  return [
    process.cwd(),
    path.join(os.homedir(), "Desktop"),
    path.join(os.homedir(), "Documents"),
    path.join(os.homedir(), "Downloads")
  ];
}

// 规范化允许根目录, 后续比较全部基于绝对路径.
function normalizeAllowedRoots(roots: string[]) {
  return roots.map((root) => path.resolve(root));
}

// 确认目标路径在允许根目录内, 阻止通过 .. 逃逸.
function assertAllowedFilePath(inputPath: string, allowedRoots: string[]) {
  const resolved = path.resolve(inputPath);
  const allowed = allowedRoots.some((root) => resolved === root || resolved.startsWith(`${root}${path.sep}`));
  if (!allowed) throw new Error("path is outside allowed roots");
  return resolved;
}

// 拒绝常见密钥和环境变量文件, 避免模型把敏感内容读写进上下文.
function assertNotSensitivePath(filePath: string) {
  if (SENSITIVE_FILE_NAMES.has(path.basename(filePath).toLowerCase())) {
    throw new Error("sensitive file is blocked");
  }
}

// 为回收文件生成稳定时间戳前缀.
function formatTimestamp(date: Date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}
