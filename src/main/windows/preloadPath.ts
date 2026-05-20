import path from "node:path";

export function resolvePreloadPath(dirname: string): string {
  return path.join(dirname, "../preload/preload.mjs");
}
