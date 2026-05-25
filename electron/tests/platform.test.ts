import { describe, expect, it } from "vitest";
import { appDataDirectory, normalizeProjectPath } from "../src/main/platform.js";

describe("platform paths", () => {
  it("normalizes project paths using the host path rules", () => {
    expect(normalizeProjectPath(".")).toContain(process.cwd().split(/[\\/]/).at(-1) ?? "samuxy");
  });

  it("uses an application scoped data directory", () => {
    expect(appDataDirectory()).toMatch(/samuxy/);
  });
});
