import { isUtf8 } from "node:buffer";
import fs from "node:fs/promises";
import path from "node:path";
import iconv from "iconv-lite";
import type { FileTreeEntry, TextFileResult, TextSearchMatch } from "../../shared/protocol.js";

const ignoredNames = new Set([".git", "node_modules", "dist", "release", "build"]);
const maxTextBytes = 2 * 1024 * 1024;
const maxPreviewBytes = 12 * 1024 * 1024;

type PreviewKind = TextFileResult["kind"];

export class FileService {
  constructor(private readonly root: string) {}

  async tree(maxDepth = 2): Promise<FileTreeEntry[]> {
    return this.listDirectory(this.root, maxDepth);
  }

  async readText(relativePath: string): Promise<TextFileResult> {
    const target = this.resolveSafe(relativePath);
    const stat = await fs.stat(target);
    if (!stat.isFile()) {
      return unsupportedResult(target, 0, "未支持：不是可预览的文件。", this.relative(target));
    }
    const size = stat.size;
    const mime = mimeFor(target);
    const kind = kindFor(target, mime);
    if (size > maxPreviewBytes) {
      return unsupportedResult(target, size, "未支持：文件过大，无法在预览器中打开。", this.relative(target));
    }

    const buffer = await fs.readFile(target);
    if (kind === "image" || kind === "pdf" || kind === "audio" || kind === "video") {
      return {
        path: this.relative(target),
        kind,
        mime,
        size,
        content: "",
        language: languageFor(target),
        markdown: false,
        editable: false,
        dataURL: `data:${mime};base64,${buffer.toString("base64")}`
      };
    }

    if (isSupportedTextPath(target) || looksTextual(buffer)) {
      if (size > maxTextBytes) {
        return unsupportedResult(target, size, "未支持：文本文件过大，无法安全渲染。", this.relative(target));
      }
      const decoded = decodeText(buffer);
      return {
        path: this.relative(target),
        kind: "text",
        mime,
        size,
        content: decoded.content,
        language: languageFor(target),
        markdown: isMarkdown(target),
        editable: true,
        encoding: decoded.encoding
      };
    }

    return unsupportedResult(target, size, "未支持：该文件类型暂不能预览。", this.relative(target));
  }

  async writeText(relativePath: string, content: string): Promise<TextFileResult> {
    const target = this.resolveSafe(relativePath);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content, "utf8");
    return this.readText(relativePath);
  }

  async search(query: string, maxResults = 80): Promise<TextSearchMatch[]> {
    const trimmed = query.trim();
    if (!trimmed) return [];
    const results: TextSearchMatch[] = [];
    await this.walk(this.root, async (filePath) => {
      if (results.length >= maxResults) return;
      const stat = await fs.stat(filePath);
      if (stat.size > maxTextBytes || !isSupportedTextPath(filePath)) return;
      let content = "";
      try {
        content = decodeText(await fs.readFile(filePath)).content;
      } catch {
        return;
      }
      const lines = content.split(/\r?\n/);
      for (const [index, line] of lines.entries()) {
        if (line.toLowerCase().includes(trimmed.toLowerCase())) {
          results.push({ path: this.relative(filePath), line: index + 1, preview: line.trim() });
          if (results.length >= maxResults) return;
        }
      }
    });
    return results;
  }

  private async listDirectory(directory: string, depth: number): Promise<FileTreeEntry[]> {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    const visible = entries
      .filter((entry) => !entry.name.startsWith(".") && !ignoredNames.has(entry.name))
      .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
    const result: FileTreeEntry[] = [];
    for (const entry of visible.slice(0, 160)) {
      const absolutePath = path.join(directory, entry.name);
      const item: FileTreeEntry = {
        name: entry.name,
        path: this.relative(absolutePath),
        kind: entry.isDirectory() ? "directory" : "file"
      };
      if (entry.isDirectory() && depth > 0) {
        item.children = await this.listDirectory(absolutePath, depth - 1);
      }
      result.push(item);
    }
    return result;
  }

  private async walk(directory: string, visit: (filePath: string) => Promise<void>): Promise<void> {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".") || ignoredNames.has(entry.name)) continue;
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await this.walk(absolutePath, visit);
      } else if (entry.isFile()) {
        await visit(absolutePath);
      }
    }
  }

  private resolveSafe(relativePath: string): string {
    const target = path.resolve(this.root, relativePath);
    const relative = path.relative(this.root, target);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error("Path escapes project root.");
    }
    return target;
  }

  private relative(filePath: string): string {
    return path.relative(this.root, filePath).replaceAll(path.sep, "/");
  }
}

function unsupportedResult(filePath: string, size: number, reason: string, displayPath = path.basename(filePath)): TextFileResult {
  return {
    path: displayPath,
    kind: "unsupported",
    mime: mimeFor(filePath),
    size,
    content: "",
    language: languageFor(filePath),
    markdown: false,
    editable: false,
    unsupportedReason: reason
  };
}

function decodeText(buffer: Buffer): { content: string; encoding: string } {
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return { content: buffer.subarray(3).toString("utf8"), encoding: "utf-8-bom" };
  }
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return { content: buffer.subarray(2).toString("utf16le"), encoding: "utf-16le" };
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    return { content: decodeUTF16BE(buffer.subarray(2)), encoding: "utf-16be" };
  }
  if (looksUTF16LE(buffer)) {
    return { content: buffer.toString("utf16le"), encoding: "utf-16le" };
  }
  if (isUtf8(buffer)) {
    return { content: buffer.toString("utf8"), encoding: "utf-8" };
  }
  return { content: iconv.decode(buffer, "gb18030"), encoding: "gb18030" };
}

function decodeUTF16BE(buffer: Buffer): string {
  const swapped = Buffer.allocUnsafe(buffer.length - (buffer.length % 2));
  for (let index = 0; index < swapped.length; index += 2) {
    swapped[index] = buffer[index + 1];
    swapped[index + 1] = buffer[index];
  }
  return swapped.toString("utf16le");
}

function looksUTF16LE(buffer: Buffer): boolean {
  if (buffer.length < 8) return false;
  let nullOdd = 0;
  const pairs = Math.min(256, Math.floor(buffer.length / 2));
  for (let index = 0; index < pairs * 2; index += 2) {
    if (buffer[index + 1] === 0) nullOdd += 1;
  }
  return nullOdd / pairs > 0.55;
}

function looksTextual(buffer: Buffer): boolean {
  if (buffer.length === 0) return true;
  if (buffer.includes(0) && !looksUTF16LE(buffer)) return false;
  if (isUtf8(buffer)) return true;
  const sample = iconv.decode(buffer.subarray(0, Math.min(buffer.length, 4096)), "gb18030");
  const replacementCount = (sample.match(/\uFFFD/g) ?? []).length;
  return replacementCount <= 2;
}

function isMarkdown(filePath: string): boolean {
  return [".md", ".markdown", ".mdx"].includes(path.extname(filePath).toLowerCase());
}

function kindFor(filePath: string, mime: string): PreviewKind {
  const ext = path.extname(filePath).toLowerCase();
  if (mime.startsWith("image/")) return "image";
  if (mime === "application/pdf") return "pdf";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  if (isSupportedTextPath(filePath)) return "text";
  if (unsupportedDocumentExtensions.has(ext) || archiveExtensions.has(ext)) return "unsupported";
  return "unsupported";
}

function isSupportedTextPath(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return textExtensions.has(ext) || codeExtensions.has(ext) || ext === "";
}

function languageFor(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return languageByExtension[ext] ?? (textExtensions.has(ext) ? "text" : "text");
}

function mimeFor(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return mimeByExtension[ext] ?? (isSupportedTextPath(filePath) ? "text/plain" : "application/octet-stream");
}

const textExtensions = new Set([
  ".txt", ".text", ".md", ".markdown", ".mdx", ".csv", ".tsv", ".log", ".ini", ".cfg", ".conf", ".env", ".properties",
  ".json", ".jsonc", ".json5", ".yaml", ".yml", ".toml", ".xml", ".plist", ".svg", ".sql", ".graphql", ".gql",
  ".patch", ".diff", ".gitignore", ".gitattributes", ".dockerignore", ".editorconfig", ".npmrc", ".lock"
]);

const codeExtensions = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".css", ".scss", ".sass", ".less", ".html", ".htm", ".vue", ".svelte",
  ".swift", ".py", ".rb", ".go", ".rs", ".java", ".kt", ".kts", ".c", ".h", ".cpp", ".cc", ".cxx", ".hpp", ".cs",
  ".php", ".sh", ".bash", ".zsh", ".fish", ".ps1", ".bat", ".cmd", ".dockerfile", ".lua", ".r", ".dart", ".scala",
  ".clj", ".ex", ".exs", ".erl", ".hrl", ".fs", ".fsx", ".vb", ".m", ".mm"
]);

const unsupportedDocumentExtensions = new Set([
  ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".pages", ".numbers", ".key", ".odt", ".ods", ".odp", ".rtf"
]);

const archiveExtensions = new Set([
  ".zip", ".rar", ".7z", ".tar", ".gz", ".tgz", ".bz2", ".xz", ".dmg", ".iso", ".exe", ".dll", ".node"
]);

const languageByExtension: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".json": "json",
  ".jsonc": "json",
  ".json5": "json",
  ".md": "markdown",
  ".markdown": "markdown",
  ".mdx": "markdown",
  ".swift": "swift",
  ".css": "css",
  ".scss": "scss",
  ".sass": "scss",
  ".less": "less",
  ".html": "xml",
  ".htm": "xml",
  ".xml": "xml",
  ".svg": "xml",
  ".vue": "xml",
  ".svelte": "xml",
  ".py": "python",
  ".rb": "ruby",
  ".go": "go",
  ".rs": "rust",
  ".java": "java",
  ".kt": "kotlin",
  ".kts": "kotlin",
  ".c": "c",
  ".h": "c",
  ".cpp": "cpp",
  ".cc": "cpp",
  ".cxx": "cpp",
  ".hpp": "cpp",
  ".cs": "csharp",
  ".php": "php",
  ".sh": "bash",
  ".bash": "bash",
  ".zsh": "bash",
  ".fish": "bash",
  ".ps1": "powershell",
  ".bat": "dos",
  ".cmd": "dos",
  ".sql": "sql",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".toml": "ini",
  ".ini": "ini",
  ".cfg": "ini",
  ".conf": "ini",
  ".diff": "diff",
  ".patch": "diff",
  ".dockerfile": "dockerfile",
  ".lua": "lua",
  ".r": "r",
  ".dart": "dart"
};

const mimeByExtension: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".ico": "image/x-icon",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".flac": "audio/flac",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".markdown": "text/markdown",
  ".json": "application/json",
  ".csv": "text/csv",
  ".html": "text/html",
  ".htm": "text/html",
  ".xml": "application/xml",
  ".css": "text/css",
  ".js": "text/javascript",
  ".ts": "text/typescript"
};
