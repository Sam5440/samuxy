import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileService } from "../src/main/files/FileService.js";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("FileService", () => {
  it("lists a bounded project tree", async () => {
    const root = makeProject();
    const tree = await new FileService(root).tree();
    expect(tree.some((entry) => entry.name === "src" && entry.kind === "directory")).toBe(true);
    expect(tree.some((entry) => entry.name === ".git")).toBe(false);
  });

  it("reads and writes text files inside the project root", async () => {
    const root = makeProject();
    const service = new FileService(root);
    const firstRead = await service.readText("README.md");
    expect(firstRead.kind).toBe("text");
    expect(firstRead.encoding).toBe("utf-8");
    expect(firstRead.markdown).toBe(true);
    expect(firstRead.language).toBe("markdown");
    const written = await service.writeText("src/app.ts", "export const value = 2;\n");
    expect(written.kind).toBe("text");
    expect(written.content).toContain("value = 2");
    expect(fs.readFileSync(path.join(root, "src", "app.ts"), "utf8")).toContain("value = 2");
  });

  it("decodes common non-UTF8 text files without mojibake", async () => {
    const root = makeProject();
    fs.writeFileSync(path.join(root, "notes-gbk.txt"), Buffer.from([0xd6, 0xd0, 0xce, 0xc4]));
    const file = await new FileService(root).readText("notes-gbk.txt");
    expect(file.kind).toBe("text");
    expect(file.encoding).toBe("gb18030");
    expect(file.content).toBe("中文");
  });

  it("returns image previews as data URLs", async () => {
    const root = makeProject();
    fs.writeFileSync(path.join(root, "pixel.png"), Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=", "base64"));
    const file = await new FileService(root).readText("pixel.png");
    expect(file.kind).toBe("image");
    expect(file.mime).toBe("image/png");
    expect(file.dataURL).toMatch(/^data:image\/png;base64,/);
    expect(file.editable).toBe(false);
  });

  it("labels unsupported binary files instead of decoding them as text", async () => {
    const root = makeProject();
    fs.writeFileSync(path.join(root, "blob.bin"), Buffer.from([0, 1, 2, 3, 4, 5]));
    const file = await new FileService(root).readText("blob.bin");
    expect(file.kind).toBe("unsupported");
    expect(file.unsupportedReason).toContain("未支持");
  });

  it("searches text files with relative paths", async () => {
    const root = makeProject();
    const matches = await new FileService(root).search("samuxy");
    expect(matches.some((match) => match.path === "README.md" && match.line === 1)).toBe(true);
  });

  it("rejects path traversal outside the project root", async () => {
    const root = makeProject();
    await expect(new FileService(root).readText("../outside.txt")).rejects.toThrow("Path escapes");
  });
});

function makeProject(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "samuxy-files-"));
  tempRoots.push(root);
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.mkdirSync(path.join(root, ".git"), { recursive: true });
  fs.writeFileSync(path.join(root, "README.md"), "# samuxy\n\nProject notes\n", "utf8");
  fs.writeFileSync(path.join(root, "src", "app.ts"), "export const value = 1;\n", "utf8");
  return root;
}
