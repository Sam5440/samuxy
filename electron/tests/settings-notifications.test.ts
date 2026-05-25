import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MobileDeviceStore } from "../src/main/mobile/MobileDeviceStore.js";
import { MobileRouter } from "../src/main/mobile/MobileRouter.js";
import { NotificationStore } from "../src/main/notifications/NotificationStore.js";
import { SettingsStore, type AppSettings } from "../src/main/settings/SettingsStore.js";
import { AppModel } from "../src/main/state/AppModel.js";
import { JSONFileStore } from "../src/main/storage/JSONFileStore.js";
import { TerminalManager } from "../src/main/terminal/TerminalManager.js";

const tempRoots: string[] = [];
const clientID = "7246d20a-44f4-4958-a29a-b255920295ac";
const deviceID = "389f48fd-7762-40f6-93f7-b82d4ad36141";

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("SettingsStore", () => {
  it("persists mobile port, shortcuts, and rich input drafts", () => {
    const filePath = path.join(makeTempRoot(), "settings.json");
    const settings = new SettingsStore(new JSONFileStore<AppSettings>(filePath));
    settings.update({ mobilePort: 4911, updateChannel: "beta", shortcuts: { quickOpen: "Ctrl+K" } });
    settings.setRichInputDraft("pane-1", "multiline prompt");

    const restored = new SettingsStore(new JSONFileStore<AppSettings>(filePath)).get();
    expect(restored.mobilePort).toBe(4911);
    expect(restored.updateChannel).toBe("beta");
    expect(restored.shortcuts.quickOpen).toBe("Ctrl+K");
    expect(restored.shortcuts.saveFile).toBe("Ctrl+S");
    expect(restored.richInputDrafts["pane-1"]).toBe("multiline prompt");
  });

  it("rejects invalid mobile ports and blank shortcuts", () => {
    const settings = new SettingsStore(new JSONFileStore<AppSettings>(path.join(makeTempRoot(), "settings.json")));
    expect(() => settings.update({ mobilePort: 80 })).toThrow("Mobile port");
    expect(() => settings.update({ shortcuts: { quickOpen: "" } })).toThrow("Shortcut");
    expect(() => settings.update({ updateChannel: "nightly" as AppSettings["updateChannel"] })).toThrow("Update channel");
  });
});

describe("NotificationStore", () => {
  it("persists notifications and marks them read", () => {
    const filePath = path.join(makeTempRoot(), "notifications.json");
    const store = new NotificationStore(new JSONFileStore(filePath));
    const notification = store.add(makeNotificationInput());
    expect(store.list()[0].isRead).toBe(false);
    expect(store.markRead(notification.id)).toBe(true);

    const restored = new NotificationStore(new JSONFileStore(filePath));
    expect(restored.list()[0].id).toBe(notification.id);
    expect(restored.list()[0].isRead).toBe(true);
  });

  it("serves notifications through authenticated mobile routes", async () => {
    const notifications = new NotificationStore();
    const notification = notifications.add(makeNotificationInput());
    const router = new MobileRouter(new AppModel(process.cwd()), new MobileDeviceStore(), new TerminalManager(), notifications);
    await router.process({
      id: "pair",
      method: "pairDevice",
      params: { type: "pairDevice", value: { deviceID, deviceName: "Phone", token: "secret" } }
    }, clientID);
    const list = await router.process({ id: "list", method: "listNotifications" }, clientID);
    expect(list.result?.type).toBe("notifications");
    if (list.result?.type !== "notifications") throw new Error("Expected notifications");
    expect(list.result.value[0].id).toBe(notification.id);

    const marked = await router.process({
      id: "mark",
      method: "markNotificationRead",
      params: { type: "markNotificationRead", value: { notificationID: notification.id } }
    }, clientID);
    expect(marked.result?.type).toBe("ok");
  });
});

function makeTempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "samuxy-settings-"));
  tempRoots.push(root);
  return root;
}

function makeNotificationInput() {
  return {
    paneID: "11111111-1111-4111-8111-111111111111",
    projectID: "22222222-2222-4222-8222-222222222222",
    worktreeID: "33333333-3333-4333-8333-333333333333",
    areaID: "44444444-4444-4444-8444-444444444444",
    tabID: "55555555-5555-4555-8555-555555555555",
    source: { type: "socket" },
    title: "Build finished",
    body: "Windows migration task completed."
  };
}
