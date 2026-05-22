import path from "node:path";

// 解析 Electron preload 文件在构建产物中的路径.
export function resolvePreloadPath(dirname: string): string {
  return path.join(dirname, "../preload/preload.cjs");
}
