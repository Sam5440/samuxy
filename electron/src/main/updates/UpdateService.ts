import { EventEmitter } from "node:events";
import type { AppSettings, SettingsStore } from "../settings/SettingsStore.js";

export type UpdateChannel = AppSettings["updateChannel"];
export type UpdateState = "idle" | "checking" | "available" | "not-available" | "downloading" | "downloaded" | "error";

export interface UpdateStatus {
  channel: UpdateChannel;
  state: UpdateState;
  currentVersion: string;
  availableVersion?: string;
  progressPercent?: number;
  message?: string;
  feedURL?: string;
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

export class UpdateService extends EventEmitter {
  private statusValue: UpdateStatus;

  constructor(
    private readonly settings: SettingsStore,
    private readonly updater: UpdaterClient,
    private readonly options: { packaged: boolean; feedURL?: string } = { packaged: true }
  ) {
    super();
    this.statusValue = {
      channel: settings.get().updateChannel,
      state: "idle",
      currentVersion: versionString(updater.currentVersion),
      feedURL: this.feedURL(settings.get().updateChannel)
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
    if (!this.options.packaged && !process.env.SAMUXY_FORCE_UPDATE_CHECK) {
      this.setStatus({ state: "idle", message: "Update checks are available in packaged builds." });
      return this.status();
    }
    this.setStatus({ state: "checking", message: undefined, progressPercent: undefined });
    try {
      await this.updater.checkForUpdates();
    } catch (error) {
      this.setStatus({ state: "error", message: (error as Error).message });
    }
    return this.status();
  }

  async downloadUpdate(): Promise<UpdateStatus> {
    this.setStatus({ state: "downloading", progressPercent: 0 });
    try {
      await this.updater.downloadUpdate();
    } catch (error) {
      this.setStatus({ state: "error", message: (error as Error).message });
    }
    return this.status();
  }

  setChannel(channel: UpdateChannel): UpdateStatus {
    this.settings.update({ updateChannel: channel });
    this.setStatus({ channel, state: "idle", availableVersion: undefined, progressPercent: undefined, message: undefined, feedURL: this.feedURL(channel) });
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

  private feedURL(channel: UpdateChannel): string {
    const override = process.env.SAMUXY_UPDATE_BASE_URL;
    if (override?.trim()) return trimSlash(override);
    return channel === "beta"
      ? "https://github.com/samuxy/samuxy/releases/download/beta-channel"
      : "https://github.com/samuxy/samuxy/releases/latest/download";
  }
}

function versionString(value: UpdaterClient["currentVersion"]): string {
  if (typeof value === "string") return value;
  return value?.version ?? "0.0.0";
}

function trimSlash(value: string): string {
  return value.replace(/\/+$/, "");
}
