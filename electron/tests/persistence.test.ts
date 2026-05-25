import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MobileDeviceStore } from "../src/main/mobile/MobileDeviceStore.js";
import { AppModel, type AppModelSnapshot } from "../src/main/state/AppModel.js";
import { JSONFileStore } from "../src/main/storage/JSONFileStore.js";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("persistent app model", () => {
  it("restores projects, worktrees, workspace, and tabs from disk", () => {
    const root = makeTempRoot();
    const storePath = path.join(root, "app-model.json");
    const model = new AppModel(root, new JSONFileStore<AppModelSnapshot>(storePath));
    const project = model.listProjects()[0];
    const workspace = model.getWorkspace(project.id);
    if (workspace?.root.type !== "tabArea") throw new Error("Expected tab area");
    const created = model.createTab(project.id, workspace.root.tabArea.id, "terminal");
    expect(created?.paneID).toBeTruthy();

    const restored = new AppModel("unused", new JSONFileStore<AppModelSnapshot>(storePath));
    const restoredProject = restored.listProjects()[0];
    const restoredWorkspace = restored.getWorkspace(restoredProject.id);
    if (restoredWorkspace?.root.type !== "tabArea") throw new Error("Expected restored tab area");
    expect(restoredProject.id).toBe(project.id);
    expect(restoredWorkspace.root.tabArea.tabs).toHaveLength(2);
    expect(restored.terminalSessions()).toHaveLength(2);
  });

  it("merges selected tabs into a shared workspace layout", () => {
    const root = makeTempRoot();
    const model = new AppModel(root, new JSONFileStore<AppModelSnapshot>(path.join(root, "app-model.json")));
    const project = model.listProjects()[0];
    const workspace = model.getWorkspace(project.id);
    if (workspace?.root.type !== "tabArea") throw new Error("Expected tab area");
    const first = workspace.root.tabArea.tabs[0];
    const second = model.createTab(project.id, workspace.root.tabArea.id, "editor");
    const third = model.createTab(project.id, workspace.root.tabArea.id, "vcs");
    if (!second || !third) throw new Error("Expected tabs");

    expect(model.mergeTabs(project.id, [first.id, second.id], "columns")).toBe(true);
    const merged = model.getWorkspace(project.id);
    if (!merged || merged.root.type !== "split") throw new Error("Expected merged split");
    expect(countAreas(merged.root)).toBe(2);

    expect(model.mergeTabs(project.id, [first.id, second.id, third.id], "rows")).toBe(true);
    const mergedAgain = model.getWorkspace(project.id);
    if (!mergedAgain || mergedAgain.root.type !== "split") throw new Error("Expected merged split");
    expect(countAreas(mergedAgain.root)).toBe(3);
  });
});

describe("persistent mobile device store", () => {
  it("restores approved device tokens from disk", () => {
    const root = makeTempRoot();
    const storePath = path.join(root, "approved-devices.json");
    const store = new MobileDeviceStore(new JSONFileStore(storePath));
    store.approve("device-1", "secret", "Phone");

    const restored = new MobileDeviceStore(new JSONFileStore(storePath));
    expect(restored.authenticate("device-1", "secret")).toBe("approved");
    expect(restored.authenticate("device-1", "changed")).toBe("unknown");
    expect(restored.nameFor("device-1")).toBe("Phone");
  });
});

function makeTempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "samuxy-electron-"));
  tempRoots.push(root);
  return root;
}

function countAreas(node: import("../src/shared/protocol.js").SplitNodeDTO): number {
  if (node.type === "tabArea") return 1;
  return countAreas(node.split.first) + countAreas(node.split.second);
}
