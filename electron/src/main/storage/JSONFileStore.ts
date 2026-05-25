import fs from "node:fs";
import path from "node:path";

export class JSONFileStore<T> {
  constructor(private readonly filePath: string) {}

  read(): T | undefined {
    try {
      const data = fs.readFileSync(this.filePath, "utf8");
      return JSON.parse(data) as T;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }

  write(value: T): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    fs.renameSync(tempPath, this.filePath);
  }
}
