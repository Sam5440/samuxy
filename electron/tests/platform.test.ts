import { describe, expect, it } from "vitest";
import { appDataDirectory, defaultShell, normalizeProjectPath } from "../src/main/platform.js";

describe("platform paths", () => {
  it("normalizes project paths using the host path rules", () => {
    expect(normalizeProjectPath(".")).toContain(process.cwd().split(/[\\/]/).at(-1) ?? "samuxy");
  });

  it("uses an application scoped data directory", () => {
    expect(appDataDirectory()).toMatch(/samuxy/);
  });

  it("prefers nushell for automatic terminal shell selection when available", () => {
    const shell = defaultShell("auto", { ComSpec: "C:\\Windows\\System32\\cmd.exe", PATH: "C:\\tools" }, (command) => command === "nu.exe");
    expect(shell).toBe("nu.exe");
  });

  it("uses explicit terminal shell choices before falling back to ComSpec", () => {
    const env = { ComSpec: "C:\\Windows\\System32\\cmd.exe", PATH: "" };
    expect(defaultShell("cmd", env, () => false)).toBe("C:\\Windows\\System32\\cmd.exe");
    expect(defaultShell("powershell", env, () => false)).toContain("WindowsPowerShell");
  });

  it("falls back to cmd when nushell is unavailable", () => {
    const env = { ComSpec: "C:\\Windows\\System32\\cmd.exe", PATH: "" };
    expect(defaultShell("nushell", env, () => false)).toBe("C:\\Windows\\System32\\cmd.exe");
  });
});
