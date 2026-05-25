import fs from "node:fs/promises";
import path from "node:path";
import type { ProjectLogoDTO } from "../../shared/protocol.js";

export class ProjectLogoStore {
  constructor(private readonly logosDirectory: string) {}

  async get(projectID: string, filename: string | undefined): Promise<ProjectLogoDTO | undefined> {
    if (!filename || filename.includes("/") || filename.includes("\\") || filename.includes("..")) return undefined;
    const filePath = path.join(this.logosDirectory, filename);
    try {
      const data = await fs.readFile(filePath);
      return { projectID, pngData: data.toString("base64") };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }
}
