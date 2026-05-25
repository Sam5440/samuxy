import os from "node:os";
import path from "node:path";

export type DesktopPlatform = "windows";

export function currentPlatform(): DesktopPlatform {
  return "windows";
}

export function defaultShell(): string {
  return process.env.ComSpec ?? "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";
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
