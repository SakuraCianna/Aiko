import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAikoFileSystem } from "../../src/main/capabilities/aikoFileSystem";

let root = "";

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "aiko-fs-"));
});

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

describe("createAikoFileSystem", () => {
  it("reads and writes text inside allowed roots", async () => {
    const fs = createAikoFileSystem({ allowedRoots: [root], trashDir: path.join(root, ".trash") });
    const filePath = path.join(root, "note.md");

    await fs.writeTextFile(filePath, "# Aiko", { overwrite: false });

    expect(readFileSync(filePath, "utf8")).toBe("# Aiko");
    await expect(fs.readTextFile(filePath)).resolves.toBe("# Aiko");
  });

  it("backs up existing files before overwriting text", async () => {
    const fs = createAikoFileSystem({
      allowedRoots: [root],
      trashDir: path.join(root, ".trash"),
      backupDir: path.join(root, ".backups")
    });
    const filePath = path.join(root, "note.md");
    writeFileSync(filePath, "old", "utf8");

    const result = await fs.writeTextFile(filePath, "new", { overwrite: true });

    expect(readFileSync(filePath, "utf8")).toBe("new");
    expect(result.backupPath).toContain(".backups");
    expect(readFileSync(result.backupPath!, "utf8")).toBe("old");
  });

  it("rejects paths outside allowed roots", async () => {
    const fs = createAikoFileSystem({ allowedRoots: [root], trashDir: path.join(root, ".trash") });

    await expect(fs.readTextFile(path.join(root, "..", "outside.txt"))).rejects.toThrow("outside allowed roots");
  });

  it("treats Windows allowed roots as case-insensitive", async () => {
    if (process.platform !== "win32") return;
    const filePath = path.join(root, "note.md");
    writeFileSync(filePath, "Aiko", "utf8");
    const fs = createAikoFileSystem({ allowedRoots: [root.toUpperCase()], trashDir: path.join(root, ".trash") });

    await expect(fs.readTextFile(filePath)).resolves.toBe("Aiko");
  });

  it("blocks environment variable variants from file access", async () => {
    const fs = createAikoFileSystem({ allowedRoots: [root], trashDir: path.join(root, ".trash") });
    const filePath = path.join(root, ".env.production");
    writeFileSync(filePath, "SECRET=value", "utf8");

    await expect(fs.readTextFile(filePath)).rejects.toThrow("sensitive file is blocked");
  });

  it("moves deleted files to the Aiko trash folder", async () => {
    const fs = createAikoFileSystem({ allowedRoots: [root], trashDir: path.join(root, ".trash") });
    const filePath = path.join(root, "old.txt");
    writeFileSync(filePath, "old", "utf8");

    const result = await fs.moveToTrash(filePath);

    expect(result.originalPath).toBe(filePath);
    expect(result.trashPath).toContain(".trash");
    await expect(fs.readTextFile(filePath)).rejects.toThrow();
    expect(readFileSync(result.trashPath, "utf8")).toBe("old");
  });

  it("writes restore metadata and restores files from Aiko trash", async () => {
    const fs = createAikoFileSystem({ allowedRoots: [root], trashDir: path.join(root, ".trash") });
    const filePath = path.join(root, "old.txt");
    writeFileSync(filePath, "old", "utf8");

    const trashed = await fs.moveToTrash(filePath);
    const metadataPath = `${trashed.trashPath}.restore.json`;

    expect(existsSync(metadataPath)).toBe(true);
    expect(JSON.parse(readFileSync(metadataPath, "utf8"))).toMatchObject({
      originalPath: filePath,
      trashPath: trashed.trashPath
    });

    const restored = await fs.restoreFromTrash(trashed.trashPath);

    expect(restored.restoredPath).toBe(filePath);
    expect(readFileSync(filePath, "utf8")).toBe("old");
    expect(existsSync(trashed.trashPath)).toBe(false);
    expect(existsSync(metadataPath)).toBe(false);
  });
});
