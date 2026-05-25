import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { SettingsStore, type AppSettings } from "../src/main/settings/SettingsStore.js";
import { JSONFileStore } from "../src/main/storage/JSONFileStore.js";
import {
  defaultRemoteVersionURL,
  defaultRepositoryURL,
  UpdateService,
  type UpdaterClient
} from "../src/main/updates/UpdateService.js";

const tempRoots: string[] = [];

afterEach(() => {
  delete process.env.SAMUXY_UPDATE_BASE_URL;
  delete process.env.SAMUXY_FORCE_UPDATE_CHECK;
  delete process.env.SAMUXY_VERSION_FILE;
  delete process.env.SAMUXY_REMOTE_VERSION_URL;
  delete process.env.SAMUXY_REPOSITORY_URL;
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("UpdateService", () => {
  it("uses the GitHub raw version URL for stable and beta checks", () => {
    const updater = new FakeUpdater();
    const settings = settingsStore();
    const service = new UpdateService(settings, updater, { packaged: true });

    expect(service.status().remoteVersionURL).toBe(defaultRemoteVersionURL);
    expect(service.status().repositoryURL).toBe(defaultRepositoryURL);
    expect(updater.feed?.url).toBe(defaultRemoteVersionURL);
    expect(updater.feed?.channel).toBe("latest");

    service.setChannel("beta");
    expect(settings.get().updateChannel).toBe("beta");
    expect(updater.channel).toBe("beta");
    expect(updater.feed?.url).toBe(defaultRemoteVersionURL);
    expect(updater.feed?.channel).toBe("beta");
  });

  it("detects a newer remote version without opening the repository automatically", async () => {
    const opened: string[] = [];
    const service = new UpdateService(settingsStore(), new FakeUpdater(), {
      packaged: true,
      versionFilePath: writeVersion("0.1.0\n"),
      fetchText: async (url) => {
        expect(url).toBe(defaultRemoteVersionURL);
        return "0.2.0\n";
      },
      openExternal: async (url) => {
        opened.push(url);
      }
    });

    const status = await service.checkForUpdates();

    expect(status).toMatchObject({
      state: "available",
      currentVersion: "0.1.0",
      availableVersion: "0.2.0",
      repositoryURL: defaultRepositoryURL
    });
    expect(opened).toEqual([]);
  });

  it("does not open the repository when the local version is current", async () => {
    const opened: string[] = [];
    const service = new UpdateService(settingsStore(), new FakeUpdater(), {
      packaged: false,
      versionFilePath: writeVersion("0.2.0"),
      fetchText: async () => "0.2.0\n",
      openExternal: async (url) => {
        opened.push(url);
      }
    });

    const status = await service.checkForUpdates();

    expect(status).toMatchObject({
      state: "not-available",
      currentVersion: "0.2.0",
      message: "samuxy is up to date."
    });
    expect(opened).toEqual([]);
  });

  it("opens the repository when the available update action is invoked", async () => {
    const opened: string[] = [];
    const service = new UpdateService(settingsStore(), new FakeUpdater(), {
      packaged: true,
      versionFilePath: writeVersion("0.1.0"),
      fetchText: async () => "0.2.0",
      openExternal: async (url) => {
        opened.push(url);
      }
    });

    await service.checkForUpdates();
    await service.downloadUpdate();

    expect(service.status().state).toBe("available");
    expect(opened).toEqual([defaultRepositoryURL]);
  });

  it("supports environment overrides and file URLs for deterministic version checks", async () => {
    const remoteVersionPath = writeVersion("0.3.0\n");
    const repositoryURL = "https://example.test/samuxy";
    process.env.SAMUXY_REMOTE_VERSION_URL = pathToFileURL(remoteVersionPath).href;
    process.env.SAMUXY_REPOSITORY_URL = repositoryURL;
    process.env.SAMUXY_VERSION_FILE = writeVersion("0.2.0");
    const service = new UpdateService(settingsStore(), new FakeUpdater(), {
      packaged: false,
      versionFilePath: writeVersion("9.9.9")
    });

    const status = await service.checkForUpdates();

    expect(status).toMatchObject({
      state: "available",
      currentVersion: "0.2.0",
      availableVersion: "0.3.0",
      remoteVersionURL: process.env.SAMUXY_REMOTE_VERSION_URL,
      repositoryURL
    });
  });

  it("reports remote version fetch failures as update errors", async () => {
    const service = new UpdateService(settingsStore(), new FakeUpdater(), {
      packaged: true,
      versionFilePath: writeVersion("0.1.0"),
      fetchText: async () => {
        throw new Error("network unavailable");
      }
    });

    const status = await service.checkForUpdates();

    expect(status.state).toBe("error");
    expect(status.message).toBe("network unavailable");
  });

  it("reports invalid local version files as update errors", async () => {
    const service = new UpdateService(settingsStore(), new FakeUpdater(), {
      packaged: true,
      versionFilePath: writeVersion("not-a-version"),
      fetchText: async () => "0.2.0"
    });

    const status = await service.checkForUpdates();

    expect(status.state).toBe("error");
    expect(status.message).toBe("Invalid version value.");
  });
});

class FakeUpdater extends EventEmitter implements UpdaterClient {
  autoDownload = true;
  autoInstallOnAppQuit = true;
  channel: string | null = null;
  currentVersion = { version: "0.1.0" };
  feed?: { provider: "generic"; url: string; channel?: string };
  installs = 0;

  setFeedURL(options: { provider: "generic"; url: string; channel?: string }): void {
    this.feed = options;
  }

  async checkForUpdates(): Promise<unknown> {
    this.emit("checking-for-update");
    return {};
  }

  async downloadUpdate(): Promise<unknown> {
    this.emit("download-progress", { percent: 45 });
    return [];
  }

  quitAndInstall(): void {
    this.installs += 1;
  }
}

function settingsStore(): SettingsStore {
  return new SettingsStore(new JSONFileStore<AppSettings>(path.join(makeTempRoot(), "settings.json")));
}

function writeVersion(content: string): string {
  const filePath = path.join(makeTempRoot(), "version");
  fs.writeFileSync(filePath, content, "utf8");
  return filePath;
}

function makeTempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "samuxy-updates-"));
  tempRoots.push(root);
  return root;
}
