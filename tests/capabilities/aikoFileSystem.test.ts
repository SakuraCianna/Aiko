import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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

  it("rejects paths outside allowed roots", async () => {
    const fs = createAikoFileSystem({ allowedRoots: [root], trashDir: path.join(root, ".trash") });

    await expect(fs.readTextFile(path.join(root, "..", "outside.txt"))).rejects.toThrow("outside allowed roots");
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
});
