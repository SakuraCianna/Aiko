import { copyFile, mkdir, readdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
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
  metadataPath?: string;
};

export type AikoFileWriteResult = {
  filePath: string;
  backupPath?: string;
};

export type AikoFileRestoreResult = {
  trashPath: string;
  restoredPath: string;
};

export type AikoFileSystem = {
  readTextFile: (filePath: string, maxBytes?: number) => Promise<string>;
  writeTextFile: (filePath: string, content: string, options: { overwrite: boolean }) => Promise<AikoFileWriteResult>;
  listDirectory: (directoryPath: string, limit?: number) => Promise<AikoDirectoryEntry[]>;
  moveToTrash: (filePath: string) => Promise<AikoFileTrashResult>;
  restoreFromTrash: (trashPath: string, destinationPath?: string) => Promise<AikoFileRestoreResult>;
};

export type AikoFileSystemOptions = {
  allowedRoots?: string[];
  trashDir?: string;
  backupDir?: string;
};

const DEFAULT_MAX_READ_BYTES = 256 * 1024;
const DEFAULT_LIST_LIMIT = 200;
const SENSITIVE_FILE_NAMES = new Set([".env", ".env.local", ".npmrc", "id_rsa", "id_ed25519"]);

// 创建 Aiko 的受控文件系统能力, 所有路径必须落在允许根目录内.
export function createAikoFileSystem(options: AikoFileSystemOptions = {}): AikoFileSystem {
  const allowedRoots = normalizeAllowedRoots(options.allowedRoots ?? createDefaultAllowedRoots());
  const trashDir = path.resolve(options.trashDir ?? path.join(os.homedir(), "Desktop", "Aiko", ".trash"));
  const backupDir = path.resolve(options.backupDir ?? path.join(os.homedir(), "Desktop", "Aiko", ".backups"));

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
      const backupPath = options.overwrite ? await backupExistingFile(resolved, backupDir) : undefined;
      await writeFile(resolved, content, { encoding: "utf8", flag: options.overwrite ? "w" : "wx" });
      return {
        filePath: resolved,
        backupPath
      };
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
      const metadataPath = `${trashPath}.restore.json`;
      await writeFile(
        metadataPath,
        `${JSON.stringify({ originalPath: resolved, trashPath, deletedAt: new Date().toISOString() }, null, 2)}\n`,
        "utf8"
      );
      return { originalPath: resolved, trashPath, metadataPath };
    },

    // 从 Aiko trash 里恢复文件, 默认恢复到删除前的原路径.
    async restoreFromTrash(trashPath, destinationPath) {
      const resolvedTrashPath = assertPathInsideRoot(path.resolve(trashPath), trashDir, "trash file is outside Aiko trash");
      const metadataPath = `${resolvedTrashPath}.restore.json`;
      const metadata = await readRestoreMetadata(metadataPath);
      const restoredPath = destinationPath
        ? assertAllowedFilePath(destinationPath, allowedRoots)
        : assertAllowedFilePath(metadata.originalPath, allowedRoots);
      assertNotSensitivePath(restoredPath);

      const trashStats = await stat(resolvedTrashPath);
      if (!trashStats.isFile()) throw new Error("trash path is not a file");
      if (await pathExists(restoredPath)) throw new Error("restore target already exists");

      await mkdir(path.dirname(restoredPath), { recursive: true });
      await rename(resolvedTrashPath, restoredPath);
      await unlink(metadataPath).catch(() => undefined);
      return {
        trashPath: resolvedTrashPath,
        restoredPath
      };
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
  assertPathInsideAnyRoot(resolved, allowedRoots, "path is outside allowed roots");
  return resolved;
}

// 确认路径在某个允许根目录内.
function assertPathInsideAnyRoot(resolvedPath: string, roots: string[], message: string) {
  const allowed = roots.some((root) => resolvedPath === root || resolvedPath.startsWith(`${root}${path.sep}`));
  if (!allowed) throw new Error(message);
}

// 确认路径在指定根目录内.
function assertPathInsideRoot(resolvedPath: string, root: string, message: string) {
  assertPathInsideAnyRoot(resolvedPath, [path.resolve(root)], message);
  return resolvedPath;
}

// 拒绝常见密钥和环境变量文件, 避免模型把敏感内容读写进上下文.
function assertNotSensitivePath(filePath: string) {
  if (SENSITIVE_FILE_NAMES.has(path.basename(filePath).toLowerCase())) {
    throw new Error("sensitive file is blocked");
  }
}

// 覆盖写入前备份旧文件, 给高风险写操作留下可恢复入口.
async function backupExistingFile(filePath: string, backupDir: string) {
  const fileStats = await statOrNull(filePath);
  if (!fileStats) return undefined;
  if (!fileStats.isFile()) throw new Error("path is not a file");

  await mkdir(backupDir, { recursive: true });
  const backupPath = path.join(backupDir, `${formatTimestamp(new Date())}-${path.basename(filePath)}`);
  await copyFile(filePath, backupPath);
  return backupPath;
}

// 读取恢复元数据, 避免恢复时依赖模型猜测原始路径.
async function readRestoreMetadata(metadataPath: string): Promise<{ originalPath: string; trashPath: string }> {
  const parsed = JSON.parse(await readFile(metadataPath, "utf8")) as Partial<{ originalPath: unknown; trashPath: unknown }>;
  if (typeof parsed.originalPath !== "string" || typeof parsed.trashPath !== "string") {
    throw new Error("invalid trash metadata");
  }
  return {
    originalPath: parsed.originalPath,
    trashPath: parsed.trashPath
  };
}

// 判断路径是否存在.
async function pathExists(filePath: string) {
  return Boolean(await statOrNull(filePath));
}

// 读取文件状态, 不存在时返回 null.
async function statOrNull(filePath: string) {
  try {
    return await stat(filePath);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return null;
    throw error;
  }
}

// 判断未知错误是否是 Node.js 系统错误.
function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

// 为回收文件生成稳定时间戳前缀.
function formatTimestamp(date: Date) {
  return date.toISOString().replace(/[-:]/g, "").replace(".", "-");
}
