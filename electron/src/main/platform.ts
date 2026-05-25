import os from "node:os";
import path from "node:path";
import fs from "node:fs";

export type DesktopPlatform = "windows";
export type TerminalShellPreference = "auto" | "nushell" | "cmd" | "powershell";

export function currentPlatform(): DesktopPlatform {
  return "windows";
}

export function defaultShell(
  preference: TerminalShellPreference = "auto",
  env: Record<string, string | undefined> = process.env,
  commandExists: (command: string, env?: Record<string, string | undefined>) => boolean = commandExistsOnPath
): string {
  const cmd = env.ComSpec ?? "C:\\Windows\\System32\\cmd.exe";
  if (preference === "nushell") return resolveNuShell(env, commandExists) ?? cmd;
  if (preference === "cmd") return cmd;
  if (preference === "powershell") return "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";
  return resolveNuShell(env, commandExists) ?? cmd;
}

function resolveNuShell(
  env: Record<string, string | undefined>,
  commandExists: (command: string, env?: Record<string, string | undefined>) => boolean
): string | undefined {
  if (commandExists("nu.exe", env)) return "nu.exe";
  const localAppData = env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local");
  const knownPaths = [
    path.join(localAppData, "Programs", "nu", "bin", "nu.exe"),
    path.join(os.homedir(), ".cargo", "bin", "nu.exe"),
    path.join(os.homedir(), "scoop", "shims", "nu.exe"),
  ];
  for (const p of knownPaths) {
    if (fs.existsSync(p)) return p;
  }
  return undefined;
}

export function appDataDirectory(appName = "samuxy"): string {
  const appDataOverride = process.env.SAMUXY_APP_DATA_DIR?.trim();
  if (appDataOverride) {
    return path.resolve(appDataOverride);
  }
  return path.join(process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"), appName);
}

export function normalizeProjectPath(input: string): string {
  return path.resolve(input);
}

function commandExistsOnPath(command: string, env: Record<string, string | undefined> = process.env): boolean {
  if (path.isAbsolute(command)) return fs.existsSync(command);
  const pathValue = env.PATH ?? env.Path ?? "";
  const extensions = (env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean);
  const candidates = path.extname(command)
    ? [command]
    : [command, ...extensions.map((extension) => `${command}${extension.toLowerCase()}`), ...extensions.map((extension) => `${command}${extension.toUpperCase()}`)];
  return pathValue.split(path.delimiter).some((directory) =>
    candidates.some((candidate) => fs.existsSync(path.join(directory, candidate)))
  );
}
