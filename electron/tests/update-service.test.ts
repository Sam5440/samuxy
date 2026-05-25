import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SettingsStore, type AppSettings } from "../src/main/settings/SettingsStore.js";
import { JSONFileStore } from "../src/main/storage/JSONFileStore.js";
import { UpdateService, type UpdaterClient } from "../src/main/updates/UpdateService.js";

const tempRoots: string[] = [];

afterEach(() => {
  delete process.env.SAMUXY_UPDATE_BASE_URL;
  delete process.env.SAMUXY_FORCE_UPDATE_CHECK;
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("UpdateService", () => {
  it("configures stable and beta generic feeds from persisted settings", () => {
    const updater = new FakeUpdater();
    const settings = settingsStore();
    const service = new UpdateService(settings, updater, { packaged: true });

    expect(updater.feed?.url).toBe("https://github.com/samuxy/samuxy/releases/latest/download");
    expect(updater.feed?.channel).toBe("latest");

    service.setChannel("beta");
    expect(settings.get().updateChannel).toBe("beta");
    expect(updater.channel).toBe("beta");
    expect(updater.feed?.url).toBe("https://github.com/samuxy/samuxy/releases/download/beta-channel");
    expect(updater.feed?.channel).toBe("beta");
  });

  it("uses an environment feed override for private Windows update testing", () => {
    process.env.SAMUXY_UPDATE_BASE_URL = "https://updates.example.test/samuxy/";
    const updater = new FakeUpdater();
    const service = new UpdateService(settingsStore(), updater, { packaged: true });

    expect(service.status().feedURL).toBe("https://updates.example.test/samuxy");
    expect(updater.feed?.url).toBe("https://updates.example.test/samuxy");
  });

  it("tracks check, download, and downloaded update states", async () => {
    const updater = new FakeUpdater();
    const service = new UpdateService(settingsStore(), updater, { packaged: true });
    const states: string[] = [];
    service.on("status", (status) => states.push(status.state));

    await service.checkForUpdates();
    expect(service.status()).toMatchObject({ state: "available", availableVersion: "0.2.0" });

    await service.downloadUpdate();
    expect(service.status()).toMatchObject({ state: "downloaded", progressPercent: 100 });
    expect(states).toContain("checking");
    expect(states).toContain("downloading");
    expect(states).toContain("downloaded");
  });

  it("does not contact update feeds from unpackaged development builds by default", async () => {
    const updater = new FakeUpdater();
    const service = new UpdateService(settingsStore(), updater, { packaged: false });

    await service.checkForUpdates();

    expect(updater.checks).toBe(0);
    expect(service.status().message).toBe("Update checks are available in packaged builds.");
  });
});

class FakeUpdater extends EventEmitter implements UpdaterClient {
  autoDownload = true;
  autoInstallOnAppQuit = true;
  channel: string | null = null;
  currentVersion = { version: "0.1.0" };
  feed?: { provider: "generic"; url: string; channel?: string };
  checks = 0;
  installs = 0;

  setFeedURL(options: { provider: "generic"; url: string; channel?: string }): void {
    this.feed = options;
  }

  async checkForUpdates(): Promise<unknown> {
    this.checks += 1;
    this.emit("checking-for-update");
    this.emit("update-available", { version: "0.2.0" });
    return {};
  }

  async downloadUpdate(): Promise<unknown> {
    this.emit("download-progress", { percent: 45 });
    this.emit("update-downloaded", { version: "0.2.0" });
    return [];
  }

  quitAndInstall(): void {
    this.installs += 1;
  }
}

function settingsStore(): SettingsStore {
  return new SettingsStore(new JSONFileStore<AppSettings>(path.join(makeTempRoot(), "settings.json")));
}

function makeTempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "samuxy-updates-"));
  tempRoots.push(root);
  return root;
}
