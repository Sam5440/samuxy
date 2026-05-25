import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import type { AppSettings, SettingsStore } from "../settings/SettingsStore.js";

export type UpdateChannel = AppSettings["updateChannel"];
export type UpdateState = "idle" | "checking" | "available" | "not-available" | "downloading" | "downloaded" | "error";

export const defaultRemoteVersionURL = "https://raw.githubusercontent.com/Sam5440/samuxy/refs/heads/main/version";
export const defaultRepositoryURL = "https://github.com/Sam5440/samuxy";

export interface UpdateStatus {
  channel: UpdateChannel;
  state: UpdateState;
  currentVersion: string;
  availableVersion?: string;
  progressPercent?: number;
  message?: string;
  feedURL?: string;
  remoteVersionURL?: string;
  repositoryURL?: string;
}

export interface UpdaterClient {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  channel: string | null;
  currentVersion?: { version: string } | string;
  setFeedURL(options: { provider: "generic"; url: string; channel?: string }): void;
  checkForUpdates(): Promise<unknown>;
  downloadUpdate(): Promise<unknown>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
  on(event: "checking-for-update", listener: () => void): this;
  on(event: "update-available", listener: (info: UpdateInfoLike) => void): this;
  on(event: "update-not-available", listener: (info: UpdateInfoLike) => void): this;
  on(event: "download-progress", listener: (progress: { percent?: number }) => void): this;
  on(event: "update-downloaded", listener: (info: UpdateInfoLike) => void): this;
  on(event: "error", listener: (error: Error) => void): this;
}

export interface UpdateInfoLike {
  version?: string;
  releaseName?: string;
}

export interface VersionUpdateOptions {
  packaged: boolean;
  feedURL?: string;
  versionFilePath?: string;
  remoteVersionURL?: string;
  repositoryURL?: string;
  fetchText?: (url: string) => Promise<string>;
  openExternal?: (url: string) => Promise<unknown>;
}

export class UpdateService extends EventEmitter {
  private statusValue: UpdateStatus;

  constructor(
    private readonly settings: SettingsStore,
    private readonly updater: UpdaterClient,
    private readonly options: VersionUpdateOptions = { packaged: true }
  ) {
    super();
    this.statusValue = {
      channel: settings.get().updateChannel,
      state: "idle",
      currentVersion: versionString(updater.currentVersion),
      feedURL: this.feedURL(settings.get().updateChannel),
      remoteVersionURL: this.remoteVersionURL(),
      repositoryURL: this.repositoryURL()
    };
    this.configure();
    this.bindEvents();
  }

  start(): void {
    this.configure();
  }

  status(): UpdateStatus {
    return structuredClone(this.statusValue);
  }

  async checkForUpdates(): Promise<UpdateStatus> {
    this.setStatus({ state: "checking", availableVersion: undefined, message: undefined, progressPercent: undefined });
    try {
      const [currentVersion, remoteVersion] = await Promise.all([
        this.readLocalVersion(),
        this.readRemoteVersion()
      ]);
      const repositoryURL = this.repositoryURL();
      if (compareVersions(remoteVersion, currentVersion) > 0) {
        this.setStatus({
          state: "available",
          currentVersion,
          availableVersion: remoteVersion,
          repositoryURL,
          message: `samuxy ${remoteVersion} is available.`
        });
      } else {
        this.setStatus({
          state: "not-available",
          currentVersion,
          availableVersion: undefined,
          repositoryURL,
          message: "samuxy is up to date."
        });
      }
    } catch (error) {
      this.setStatus({ state: "error", message: (error as Error).message });
    }
    return this.status();
  }

  async downloadUpdate(): Promise<UpdateStatus> {
    if (this.statusValue.state === "available") {
      await this.openRepository(this.repositoryURL());
      return this.status();
    }
    this.setStatus({ state: "checking", progressPercent: undefined });
    try {
      await this.checkForUpdates();
    } catch (error) {
      this.setStatus({ state: "error", message: (error as Error).message });
    }
    return this.status();
  }

  setChannel(channel: UpdateChannel): UpdateStatus {
    this.settings.update({ updateChannel: channel });
    this.setStatus({
      channel,
      state: "idle",
      availableVersion: undefined,
      progressPercent: undefined,
      message: undefined,
      feedURL: this.feedURL(channel),
      remoteVersionURL: this.remoteVersionURL(),
      repositoryURL: this.repositoryURL()
    });
    this.configure();
    return this.status();
  }

  installDownloadedUpdate(): void {
    this.updater.quitAndInstall(false, true);
  }

  private configure(): void {
    const channel = this.settings.get().updateChannel;
    this.updater.autoDownload = false;
    this.updater.autoInstallOnAppQuit = false;
    this.updater.channel = channel === "beta" ? "beta" : null;
    this.updater.setFeedURL({
      provider: "generic",
      url: this.feedURL(channel),
      channel: channel === "beta" ? "beta" : "latest"
    });
  }

  private bindEvents(): void {
    this.updater.on("checking-for-update", () => this.setStatus({ state: "checking", message: undefined }));
    this.updater.on("update-available", (info) => this.setStatus({
      state: "available",
      availableVersion: info.version ?? info.releaseName,
      progressPercent: undefined,
      message: undefined
    }));
    this.updater.on("update-not-available", () => this.setStatus({
      state: "not-available",
      availableVersion: undefined,
      progressPercent: undefined,
      message: "samuxy is up to date."
    }));
    this.updater.on("download-progress", (progress) => this.setStatus({
      state: "downloading",
      progressPercent: progress.percent === undefined ? undefined : Math.max(0, Math.min(100, progress.percent))
    }));
    this.updater.on("update-downloaded", (info) => this.setStatus({
      state: "downloaded",
      availableVersion: info.version ?? this.statusValue.availableVersion,
      progressPercent: 100,
      message: "Update downloaded."
    }));
    this.updater.on("error", (error) => this.setStatus({ state: "error", message: error.message }));
  }

  private setStatus(patch: Partial<UpdateStatus>): void {
    this.statusValue = { ...this.statusValue, ...patch };
    this.emit("status", this.status());
  }

  private feedURL(_channel: UpdateChannel): string {
    return this.remoteVersionURL();
  }

  private remoteVersionURL(): string {
    return process.env.SAMUXY_REMOTE_VERSION_URL ?? this.options.remoteVersionURL ?? defaultRemoteVersionURL;
  }

  private repositoryURL(): string {
    return process.env.SAMUXY_REPOSITORY_URL ?? this.options.repositoryURL ?? defaultRepositoryURL;
  }

  private async readLocalVersion(): Promise<string> {
    const versionFilePath = process.env.SAMUXY_VERSION_FILE ?? this.options.versionFilePath;
    if (!versionFilePath?.trim()) {
      return normalizeVersion(versionString(this.updater.currentVersion));
    }
    const content = await fs.readFile(versionFilePath, "utf8");
    return normalizeVersion(content);
  }

  private async readRemoteVersion(): Promise<string> {
    const content = await (this.options.fetchText ?? fetchText)(this.remoteVersionURL());
    return normalizeVersion(content);
  }

  private async openRepository(url: string): Promise<void> {
    await this.options.openExternal?.(url);
  }
}

function versionString(value: UpdaterClient["currentVersion"]): string {
  if (typeof value === "string") return value;
  return value?.version ?? "0.0.0";
}

async function fetchText(url: string): Promise<string> {
  const parsedURL = new URL(url);
  if (parsedURL.protocol === "file:") {
    return fs.readFile(parsedURL, "utf8");
  }
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Version request failed: ${response.status} ${response.statusText}`);
  }
  return response.text();
}

function normalizeVersion(content: string): string {
  const version = content.split(/\r?\n/).map((line) => line.trim()).find(Boolean)?.replace(/^v/i, "");
  if (!version || !/^\d+(?:\.\d+){0,3}(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error("Invalid version value.");
  }
  return version;
}

function compareVersions(left: string, right: string): number {
  const parsedLeft = parseVersion(left);
  const parsedRight = parseVersion(right);
  for (let index = 0; index < Math.max(parsedLeft.numbers.length, parsedRight.numbers.length); index += 1) {
    const diff = (parsedLeft.numbers[index] ?? 0) - (parsedRight.numbers[index] ?? 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  if (parsedLeft.prerelease === parsedRight.prerelease) return 0;
  if (!parsedLeft.prerelease) return 1;
  if (!parsedRight.prerelease) return -1;
  return parsedLeft.prerelease.localeCompare(parsedRight.prerelease);
}

function parseVersion(version: string): { numbers: number[]; prerelease: string } {
  const [base, prerelease = ""] = version.split(/[-+]/, 2);
  return {
    numbers: base.split(".").map((part) => Number(part)),
    prerelease
  };
}
