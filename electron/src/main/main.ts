import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import electronUpdater from "electron-updater";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AppModel } from "./state/AppModel.js";
import { MobileDeviceStore } from "./mobile/MobileDeviceStore.js";
import { MobileRouter } from "./mobile/MobileRouter.js";
import { MobileServer } from "./mobile/MobileServer.js";
import { TerminalManager } from "./terminal/TerminalManager.js";
import { appDataDirectory } from "./platform.js";
import { JSONFileStore } from "./storage/JSONFileStore.js";
import type { AppModelSnapshot } from "./state/AppModel.js";
import { FileService } from "./files/FileService.js";
import { SettingsStore, type AppSettings } from "./settings/SettingsStore.js";
import { NotificationStore, type NotificationInput } from "./notifications/NotificationStore.js";
import { AIUsageService } from "./ai/AIUsageService.js";
import { UpdateService } from "./updates/UpdateService.js";
import { ProjectLogoStore } from "./projects/ProjectLogoStore.js";
import { GitService } from "./vcs/GitService.js";
import type { PaneOwnerDTO, SplitDirection, SplitNodeDTO, TabKind, TabMergeLayout } from "../shared/protocol.js";

const { autoUpdater } = electronUpdater;
const dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDirectory = appDataDirectory();
const windows = new Set<BrowserWindow>();
const settings = new SettingsStore(new JSONFileStore<AppSettings>(path.join(dataDirectory, "settings.json")));
const notifications = new NotificationStore(new JSONFileStore(path.join(dataDirectory, "notifications.json")));
const aiUsage = new AIUsageService();
const updates = new UpdateService(settings, autoUpdater, {
  packaged: app.isPackaged,
  versionFilePath: path.resolve(dirname, "../../..", "version"),
  openExternal: (url) => shell.openExternal(url)
});
const model = new AppModel(process.cwd(), new JSONFileStore<AppModelSnapshot>(path.join(dataDirectory, "app-model.json")));
const terminals = new TerminalManager();
const git = new GitService();
for (const session of model.terminalSessions()) {
  terminals.create(session);
}
const router = new MobileRouter(
  model,
  new MobileDeviceStore(new JSONFileStore(path.join(dataDirectory, "approved-devices.json"))),
  terminals,
  notifications,
  git,
  undefined,
  new ProjectLogoStore(path.join(dataDirectory, "logos"))
);
const server = new MobileServer(router, settings.get().mobilePort);
router.on("event", (event) => {
  server.broadcast(event);
  if (event.event === "paneOwnershipChanged" && event.data.type === "paneOwnership") {
    for (const window of windows) {
      window.webContents.send("samuxy:paneOwnershipChanged", event.data.value);
    }
  }
});
terminals.on("output", ({ paneID, data }: { paneID: string; data: string }) => {
  for (const window of windows) {
    window.webContents.send("samuxy:terminalOutput", { paneID, data });
  }
  server.broadcast({
    event: "terminalOutput",
    data: {
      type: "terminalOutput",
      value: {
        paneID,
        bytes: Buffer.from(data, "utf8").toString("base64")
      }
    }
  });
  const snapshot = terminals.snapshot(paneID);
  if (snapshot) {
    server.broadcast({
      event: "terminalSnapshot",
      data: {
        type: "terminalSnapshot",
        value: {
          paneID,
          bytes: Buffer.from(snapshot.content, "utf8").toString("base64")
        }
      }
    });
  }
});
updates.on("status", (status) => {
  for (const window of windows) {
    window.webContents.send("samuxy:updateStatusChanged", status);
  }
});

async function createWindow(): Promise<void> {
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 620,
    titleBarStyle: "hiddenInset",
    webPreferences: {
      preload: path.join(dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  windows.add(window);
  window.on("closed", () => {
    windows.delete(window);
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    await window.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    await window.loadFile(path.join(dirname, "../renderer/index.html"));
  }
}

function dashboardPayload(selectedProjectID?: string) {
  const projects = model.listProjects();
  const selected = projects.find((project) => project.id === selectedProjectID) ?? projects[0];
  return {
    projects,
    workspace: selected ? model.getWorkspace(selected.id) : undefined,
    mobilePort: settings.get().mobilePort
  };
}

function tabPaneID(root: SplitNodeDTO | undefined, areaID: string, tabID: string): string | undefined {
  if (!root) return undefined;
  if (root.type === "tabArea") {
    if (root.tabArea.id !== areaID) return undefined;
    return root.tabArea.tabs.find((tab) => tab.id === tabID)?.paneID;
  }
  return tabPaneID(root.split.first, areaID, tabID) ?? tabPaneID(root.split.second, areaID, tabID);
}

ipcMain.handle("samuxy:dashboard", () => {
  return dashboardPayload();
});

ipcMain.handle("samuxy:addProject", async () => {
  const result = await dialog.showOpenDialog({
    properties: ["openDirectory"],
    title: "Add Project"
  });
  const projectPath = result.filePaths[0];
  if (result.canceled || !projectPath) return undefined;
  const existing = model.listProjects().find((project) => project.path === projectPath);
  if (existing) return dashboardPayload(existing.id);
  const project = model.addProject(projectPath);
  for (const session of model.terminalSessions()) {
    terminals.create(session);
  }
  return dashboardPayload(project.id);
});

ipcMain.handle("samuxy:selectProject", (_event, projectID: string) => {
  return model.selectProject(projectID) ? model.getWorkspace(projectID) : undefined;
});

ipcMain.handle("samuxy:createTab", (_event, projectID: string, areaID: string | undefined, kind: TabKind) => {
  const tab = model.createTab(projectID, areaID, kind);
  if (!tab) return undefined;
  if (tab.paneID) {
    const descriptor = model.terminalSessionFor(projectID, tab.paneID);
    if (descriptor) terminals.create(descriptor);
  }
  return model.getWorkspace(projectID);
});

ipcMain.handle("samuxy:selectTab", (_event, projectID: string, areaID: string, tabID: string) => {
  return model.selectTab(projectID, areaID, tabID) ? model.getWorkspace(projectID) : undefined;
});

ipcMain.handle("samuxy:closeTab", (_event, projectID: string, areaID: string, tabID: string) => {
  const paneID = tabPaneID(model.getWorkspace(projectID)?.root, areaID, tabID);
  const ok = model.closeTab(projectID, areaID, tabID);
  if (ok && paneID) terminals.close(paneID);
  return ok ? model.getWorkspace(projectID) : undefined;
});

ipcMain.handle("samuxy:splitArea", (_event, projectID: string, areaID: string, direction: SplitDirection, position: "first" | "second") => {
  const descriptor = model.splitArea(projectID, areaID, direction, position);
  if (!descriptor) return undefined;
  terminals.create(descriptor);
  return model.getWorkspace(projectID);
});

ipcMain.handle("samuxy:mergeTabs", (_event, projectID: string, tabIDs: string[], layout: TabMergeLayout) => {
  return model.mergeTabs(projectID, tabIDs, layout) ? model.getWorkspace(projectID) : undefined;
});

ipcMain.handle("samuxy:closeArea", (_event, projectID: string, areaID: string) => {
  const result = model.closeArea(projectID, areaID);
  if (!result.ok) return undefined;
  for (const paneID of result.closedPaneIDs) {
    terminals.close(paneID);
  }
  return model.getWorkspace(projectID);
});

ipcMain.handle("samuxy:focusArea", (_event, projectID: string, areaID: string) => {
  return model.focusArea(projectID, areaID) ? model.getWorkspace(projectID) : undefined;
});

ipcMain.handle("samuxy:terminalSnapshot", (_event, paneID: string) => terminals.snapshot(paneID));

ipcMain.handle("samuxy:terminalInput", (_event, paneID: string, text: string) => {
  if (router.isPaneOwnedByRemote(paneID)) return false;
  return terminals.write(paneID, Buffer.from(text, "utf8").toString("base64"));
});

ipcMain.handle("samuxy:terminalResize", (_event, paneID: string, cols: number, rows: number) => {
  if (router.isPaneOwnedByRemote(paneID)) return false;
  return terminals.resize(paneID, cols, rows);
});

ipcMain.handle("samuxy:paneOwner", (_event, paneID: string): PaneOwnerDTO => {
  return router.paneOwner(paneID);
});

ipcMain.handle("samuxy:takeOverPaneLocally", (_event, paneID: string) => {
  return router.takeOverPaneOnDesktop(paneID);
});

ipcMain.handle("samuxy:getSettings", () => settings.get());

ipcMain.handle("samuxy:updateSettings", (_event, patch: Partial<AppSettings>) => settings.update(patch));

ipcMain.handle("samuxy:setRichInputDraft", (_event, paneID: string, draft: string) => settings.setRichInputDraft(paneID, draft));

ipcMain.handle("samuxy:notifications", () => notifications.list());

ipcMain.handle("samuxy:markNotificationRead", (_event, notificationID: string) => notifications.markRead(notificationID));

ipcMain.handle("samuxy:addNotification", (_event, input: NotificationInput) => {
  const notification = notifications.add(input);
  server.broadcast({ event: "notificationReceived", data: { type: "notification", value: notification } });
  return notification;
});

ipcMain.handle("samuxy:aiUsage", () => aiUsage.snapshots());

ipcMain.handle("samuxy:updateStatus", () => updates.status());

ipcMain.handle("samuxy:checkForUpdates", () => updates.checkForUpdates());

ipcMain.handle("samuxy:setUpdateChannel", (_event, channel: "stable" | "beta") => updates.setChannel(channel));

ipcMain.handle("samuxy:downloadUpdate", () => updates.downloadUpdate());

ipcMain.handle("samuxy:installDownloadedUpdate", () => updates.installDownloadedUpdate());

ipcMain.handle("samuxy:fileTree", async (_event, projectID: string) => {
  const projectPath = model.projectPath(projectID);
  if (!projectPath) throw new Error("Project not found.");
  return new FileService(projectPath).tree();
});

ipcMain.handle("samuxy:readFile", async (_event, projectID: string, filePath: string) => {
  const projectPath = model.projectPath(projectID);
  if (!projectPath) throw new Error("Project not found.");
  return new FileService(projectPath).readText(filePath);
});

ipcMain.handle("samuxy:writeFile", async (_event, projectID: string, filePath: string, content: string) => {
  const projectPath = model.projectPath(projectID);
  if (!projectPath) throw new Error("Project not found.");
  return new FileService(projectPath).writeText(filePath, content);
});

ipcMain.handle("samuxy:searchFiles", async (_event, projectID: string, query: string) => {
  const projectPath = model.projectPath(projectID);
  if (!projectPath) throw new Error("Project not found.");
  return new FileService(projectPath).search(query);
});

ipcMain.handle("samuxy:vcsStatus", async (_event, projectID: string) => {
  const projectPath = model.projectPath(projectID);
  if (!projectPath) throw new Error("Project not found.");
  return git.status(projectPath);
});

app.whenReady().then(async () => {
  updates.start();
  await server.start();
  await createWindow();
});

app.on("window-all-closed", () => {
  app.quit();
});

app.on("before-quit", () => {
  void server.stop();
});
