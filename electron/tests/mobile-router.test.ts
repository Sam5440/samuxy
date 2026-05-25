import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AppModel } from "../src/main/state/AppModel.js";
import { MobileDeviceStore } from "../src/main/mobile/MobileDeviceStore.js";
import { MobileRouter } from "../src/main/mobile/MobileRouter.js";
import { ProjectLogoStore } from "../src/main/projects/ProjectLogoStore.js";
import { TerminalManager } from "../src/main/terminal/TerminalManager.js";
import type { SamuxyRequest, SplitNodeDTO } from "../src/shared/protocol.js";

const clientID = "9f60fd1f-0961-4bd8-bab1-7a04b655f092";
const deviceID = "a558f746-a734-41f1-a592-bce2b4c334d1";

function makeRouter() {
  return new MobileRouter(new AppModel(process.cwd()), new MobileDeviceStore(), new TerminalManager());
}

describe("mobile protocol router", () => {
  it("rejects project requests before pairing", async () => {
    const response = await makeRouter().process({ id: "1", method: "listProjects" }, clientID);
    expect(response.error?.code).toBe(401);
  });

  it("pairs a device and then lists projects", async () => {
    const router = makeRouter();
    const pair: SamuxyRequest = {
      id: "pair",
      method: "pairDevice",
      params: { type: "pairDevice", value: { deviceID, deviceName: "Pixel", token: "secret" } }
    };
    expect((await router.process(pair, clientID)).result?.type).toBe("pairing");
    const projects = await router.process({ id: "projects", method: "listProjects" }, clientID);
    expect(projects.result?.type).toBe("projects");
    if (projects.result?.type !== "projects") throw new Error("Expected projects result");
    expect(projects.result.value.length).toBeGreaterThan(0);
  });

  it("authenticates an approved mobile device with its token", async () => {
    const router = makeRouter();
    await router.process({
      id: "pair",
      method: "pairDevice",
      params: { type: "pairDevice", value: { deviceID, deviceName: "iPhone", token: "secret" } }
    }, clientID);
    const response = await router.process({
      id: "auth",
      method: "authenticateDevice",
      params: { type: "authenticateDevice", value: { deviceID, deviceName: "iPhone", token: "secret" } }
    }, "22222222-2222-4222-8222-222222222222");
    expect(response.result?.type).toBe("pairing");
  });

  it("rejects an approved device when the token changes", async () => {
    const router = makeRouter();
    await router.process({
      id: "pair",
      method: "pairDevice",
      params: { type: "pairDevice", value: { deviceID, deviceName: "iPhone", token: "secret" } }
    }, clientID);
    const response = await router.process({
      id: "auth",
      method: "authenticateDevice",
      params: { type: "authenticateDevice", value: { deviceID, deviceName: "iPhone", token: "wrong" } }
    }, "33333333-3333-4333-8333-333333333333");
    expect(response.error?.code).toBe(401);
  });

  it("creates a terminal session for mobile-created terminal tabs", async () => {
    const terminals = new RecordingTerminalManager();
    const model = new AppModel(process.cwd());
    const router = new MobileRouter(model, new MobileDeviceStore(), terminals);
    await router.process({
      id: "pair",
      method: "pairDevice",
      params: { type: "pairDevice", value: { deviceID, deviceName: "iPhone", token: "secret" } }
    }, clientID);
    const project = model.listProjects()[0];
    const workspace = model.getWorkspace(project.id);
    if (workspace?.root.type !== "tabArea") throw new Error("Expected tab area");
    const response = await router.process({
      id: "tab",
      method: "createTab",
      params: { type: "createTab", value: { projectID: project.id, areaID: workspace.root.tabArea.id, kind: "terminal" } }
    }, clientID);
    expect(response.result?.type).toBe("tab");
    expect(terminals.created).toHaveLength(1);
    expect(terminals.created[0].cwd).toBe(process.cwd());
  });

  it("splits and closes workspace areas through authenticated mobile routes", async () => {
    const terminals = new RecordingTerminalManager();
    const model = new AppModel(process.cwd());
    const router = new MobileRouter(model, new MobileDeviceStore(), terminals);
    await pair(router);
    const project = model.listProjects()[0];
    const workspace = model.getWorkspace(project.id);
    if (workspace?.root.type !== "tabArea") throw new Error("Expected tab area");

    const split = await router.process({
      id: "split",
      method: "splitArea",
      params: { type: "splitArea", value: { projectID: project.id, areaID: workspace.root.tabArea.id, direction: "horizontal", position: "second" } }
    }, clientID);
    expect(split.result?.type).toBe("ok");
    const splitWorkspace = model.getWorkspace(project.id);
    if (!splitWorkspace?.focusedAreaID) throw new Error("Expected focused area");
    expect(countAreas(splitWorkspace.root)).toBe(2);
    expect(terminals.created).toHaveLength(1);

    const close = await router.process({
      id: "close",
      method: "closeArea",
      params: { type: "closeArea", value: { projectID: project.id, areaID: splitWorkspace.focusedAreaID } }
    }, clientID);
    expect(close.result?.type).toBe("ok");
    const closedWorkspace = model.getWorkspace(project.id);
    if (!closedWorkspace) throw new Error("Expected workspace");
    expect(countAreas(closedWorkspace.root)).toBe(1);
    expect(terminals.closed).toEqual([terminals.created[0].paneID]);
  });

  it("routes project, worktree, tab, focus, registration, and subscription methods", async () => {
    const terminals = new RecordingTerminalManager();
    const model = new AppModel(process.cwd());
    const router = new MobileRouter(model, new MobileDeviceStore(), terminals);
    await pair(router);
    const project = model.listProjects()[0];
    const workspace = model.getWorkspace(project.id);
    if (workspace?.root.type !== "tabArea") throw new Error("Expected tab area");
    const primaryWorktree = model.listWorktrees(project.id)[0];
    const secondaryWorktree = model.addWorktree(project.id, "secondary", process.cwd(), "feature/mobile");
    if (!secondaryWorktree) throw new Error("Expected secondary worktree");

    const selectedProject = await router.process({
      id: "select-project",
      method: "selectProject",
      params: { type: "selectProject", value: { projectID: project.id } }
    }, clientID);
    expect(selectedProject.result?.type).toBe("ok");

    const worktrees = await router.process({
      id: "worktrees",
      method: "listWorktrees",
      params: { type: "listWorktrees", value: { projectID: project.id } }
    }, clientID);
    expect(worktrees.result?.type).toBe("worktrees");
    if (worktrees.result?.type !== "worktrees") throw new Error("Expected worktrees");
    expect(worktrees.result.value.map((worktree) => worktree.id)).toContain(primaryWorktree.id);

    const selectedWorktree = await router.process({
      id: "select-worktree",
      method: "selectWorktree",
      params: { type: "selectWorktree", value: { projectID: project.id, worktreeID: secondaryWorktree.id } }
    }, clientID);
    expect(selectedWorktree.result?.type).toBe("ok");
    expect(model.getWorkspace(project.id)?.worktreeID).toBe(secondaryWorktree.id);

    const createdEditor = await router.process({
      id: "create-editor",
      method: "createTab",
      params: { type: "createTab", value: { projectID: project.id, areaID: workspace.root.tabArea.id, kind: "editor" } }
    }, clientID);
    expect(createdEditor.result?.type).toBe("tab");
    if (createdEditor.result?.type !== "tab") throw new Error("Expected tab");

    const selectedTab = await router.process({
      id: "select-tab",
      method: "selectTab",
      params: { type: "selectTab", value: { projectID: project.id, areaID: workspace.root.tabArea.id, tabID: createdEditor.result.value.id } }
    }, clientID);
    expect(selectedTab.result?.type).toBe("ok");

    const focused = await router.process({
      id: "focus-area",
      method: "focusArea",
      params: { type: "focusArea", value: { projectID: project.id, areaID: workspace.root.tabArea.id } }
    }, clientID);
    expect(focused.result?.type).toBe("ok");

    const closedTab = await router.process({
      id: "close-tab",
      method: "closeTab",
      params: { type: "closeTab", value: { projectID: project.id, areaID: workspace.root.tabArea.id, tabID: createdEditor.result.value.id } }
    }, clientID);
    expect(closedTab.result?.type).toBe("ok");

    const registered = await router.process({
      id: "register",
      method: "registerDevice",
      params: { type: "registerDevice", value: { deviceName: "Tablet" } }
    }, clientID);
    expect(registered.result?.type).toBe("deviceInfo");

    const subscribed = await router.process({
      id: "subscribe",
      method: "subscribe",
      params: { type: "subscribe", value: { events: ["terminalOutput"] } }
    }, clientID);
    const unsubscribed = await router.process({
      id: "unsubscribe",
      method: "unsubscribe",
      params: { type: "unsubscribe", value: { events: ["terminalOutput"] } }
    }, clientID);
    expect(subscribed.result?.type).toBe("ok");
    expect(unsubscribed.result?.type).toBe("ok");
  });

  it("requires pane ownership for mobile terminal input and resize", async () => {
    const terminals = new RecordingTerminalManager();
    const model = new AppModel(process.cwd());
    const router = new MobileRouter(model, new MobileDeviceStore(), terminals);
    await pair(router);
    const project = model.listProjects()[0];
    const workspace = model.getWorkspace(project.id);
    if (workspace?.root.type !== "tabArea") throw new Error("Expected tab area");
    const paneID = workspace.root.tabArea.tabs[0].paneID;
    if (!paneID) throw new Error("Expected terminal pane");

    const denied = await router.process({
      id: "input-denied",
      method: "terminalInput",
      params: { type: "terminalInput", value: { paneID, bytes: Buffer.from("pwd\n").toString("base64") } }
    }, clientID);
    expect(denied.error?.code).toBe(401);

    const takeOver = await router.process({
      id: "takeover",
      method: "takeOverPane",
      params: { type: "takeOverPane", value: { paneID, cols: 100, rows: 30 } }
    }, clientID);
    expect(takeOver.result?.type).toBe("ok");
    expect(terminals.resized.at(-1)).toEqual({ paneID, cols: 100, rows: 30 });

    const input = await router.process({
      id: "input",
      method: "terminalInput",
      params: { type: "terminalInput", value: { paneID, bytes: Buffer.from("pwd\n").toString("base64") } }
    }, clientID);
    expect(input.result?.type).toBe("ok");
    expect(terminals.writes).toEqual([{ paneID, bytes: Buffer.from("pwd\n").toString("base64") }]);

    const resize = await router.process({
      id: "resize",
      method: "terminalResize",
      params: { type: "terminalResize", value: { paneID, cols: 90, rows: 28 } }
    }, clientID);
    expect(resize.result?.type).toBe("ok");
    expect(terminals.resized.at(-1)).toEqual({ paneID, cols: 90, rows: 28 });

    const release = await router.process({
      id: "release",
      method: "releasePane",
      params: { type: "releasePane", value: { paneID } }
    }, clientID);
    expect(release.result?.type).toBe("ok");

    const deniedAfterRelease = await router.process({
      id: "input-denied-after-release",
      method: "terminalInput",
      params: { type: "terminalInput", value: { paneID, bytes: Buffer.from("pwd\n").toString("base64") } }
    }, clientID);
    expect(deniedAfterRelease.error?.code).toBe(401);
  });

  it("requires pane ownership before applying mobile terminal scroll", async () => {
    const terminals = new RecordingTerminalManager();
    const model = new AppModel(process.cwd());
    const router = new MobileRouter(model, new MobileDeviceStore(), terminals);
    await pair(router);
    const project = model.listProjects()[0];
    const workspace = model.getWorkspace(project.id);
    if (workspace?.root.type !== "tabArea") throw new Error("Expected tab area");
    const paneID = workspace.root.tabArea.tabs[0].paneID;
    if (!paneID) throw new Error("Expected terminal pane");

    const denied = await router.process({
      id: "scroll-denied",
      method: "terminalScroll",
      params: { type: "terminalScroll", value: { paneID, deltaX: 0, deltaY: 3, precise: true } }
    }, clientID);
    expect(denied.error?.code).toBe(401);

    await router.process({
      id: "takeover",
      method: "takeOverPane",
      params: { type: "takeOverPane", value: { paneID, cols: 100, rows: 30 } }
    }, clientID);
    const accepted = await router.process({
      id: "scroll",
      method: "terminalScroll",
      params: { type: "terminalScroll", value: { paneID, deltaX: 0, deltaY: 3, precise: true } }
    }, clientID);

    expect(accepted.result?.type).toBe("ok");
    expect(terminals.scrolls).toEqual([{ paneID, deltaY: 3, precise: true }]);
  });

  it("returns mobile terminal cell snapshots", async () => {
    const terminals = new BufferedTerminalManager();
    const router = new MobileRouter(new AppModel(process.cwd()), new MobileDeviceStore(), terminals);
    await router.process({
      id: "pair",
      method: "pairDevice",
      params: { type: "pairDevice", value: { deviceID, deviceName: "iPhone", token: "secret" } }
    }, clientID);
    const response = await router.process({
      id: "content",
      method: "getTerminalContent",
      params: { type: "getTerminalContent", value: { paneID: "pane-1" } }
    }, clientID);
    expect(response.result?.type).toBe("terminalCells");
    if (response.result?.type !== "terminalCells") throw new Error("Expected terminal cells");
    expect(response.result.value.cells.map((cell) => String.fromCodePoint(cell.codepoint)).join("")).toContain("hello");
    expect(response.result.value.cursorVisible).toBe(true);
  });

  it("serves project files to authenticated mobile clients", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "samuxy-mobile-files-"));
    try {
      fs.writeFileSync(path.join(root, "README.md"), "# samuxy mobile\n", "utf8");
      const model = new AppModel(root);
      const router = new MobileRouter(model, new MobileDeviceStore(), new TerminalManager());
      await router.process({
        id: "pair",
        method: "pairDevice",
        params: { type: "pairDevice", value: { deviceID, deviceName: "iPhone", token: "secret" } }
      }, clientID);
      const project = model.listProjects()[0];
      const tree = await router.process({
        id: "files",
        method: "listFiles",
        params: { type: "listFiles", value: { projectID: project.id } }
      }, clientID);
      expect(tree.result?.type).toBe("fileTree");
      const read = await router.process({
        id: "read",
        method: "readFile",
        params: { type: "readFile", value: { projectID: project.id, filePath: "README.md" } }
      }, clientID);
      expect(read.result?.type).toBe("textFile");
      if (read.result?.type !== "textFile") throw new Error("Expected text file");
      expect(read.result.value.content).toContain("samuxy mobile");
      const search = await router.process({
        id: "search",
        method: "searchFiles",
        params: { type: "searchFiles", value: { projectID: project.id, query: "mobile" } }
      }, clientID);
      expect(search.result?.type).toBe("fileSearch");
      const write = await router.process({
        id: "write",
        method: "writeFile",
        params: { type: "writeFile", value: { projectID: project.id, filePath: "notes/windows.md", content: "# Windows\n" } }
      }, clientID);
      expect(write.result?.type).toBe("textFile");
      if (write.result?.type !== "textFile") throw new Error("Expected written text file");
      expect(write.result.value.path).toBe("notes/windows.md");
      expect(fs.readFileSync(path.join(root, "notes", "windows.md"), "utf8")).toBe("# Windows\n");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("serves project logo payloads to authenticated mobile clients", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "samuxy-mobile-logo-"));
    try {
      const logos = path.join(root, "logos");
      fs.mkdirSync(logos);
      fs.writeFileSync(path.join(logos, "project.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
      const model = new AppModel(root);
      const project = model.listProjects()[0];
      model.setProjectLogo(project.id, "project.png");
      const router = new MobileRouter(
        model,
        new MobileDeviceStore(),
        new TerminalManager(),
        undefined,
        undefined,
        undefined,
        new ProjectLogoStore(logos)
      );
      await pair(router);
      const response = await router.process({
        id: "logo",
        method: "getProjectLogo",
        params: { type: "getProjectLogo", value: { projectID: project.id } }
      }, clientID);
      expect(response.result?.type).toBe("projectLogo");
      if (response.result?.type !== "projectLogo") throw new Error("Expected project logo");
      expect(response.result.value.pngData).toBe(Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString("base64"));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

class RecordingTerminalManager extends TerminalManager {
  readonly created: Array<{ paneID: string; title: string; cwd: string; cols: number; rows: number }> = [];
  readonly closed: string[] = [];
  readonly resized: Array<{ paneID: string; cols: number; rows: number }> = [];
  readonly writes: Array<{ paneID: string; bytes: string }> = [];
  readonly scrolls: Array<{ paneID: string; deltaY: number; precise: boolean }> = [];

  override create(session: { paneID: string; title: string; cwd: string; cols: number; rows: number }): void {
    this.created.push(session);
  }

  override close(paneID: string): void {
    this.closed.push(paneID);
  }

  override resize(paneID: string, cols: number, rows: number): boolean {
    this.resized.push({ paneID, cols, rows });
    return true;
  }

  override write(paneID: string, bytes: string): boolean {
    this.writes.push({ paneID, bytes });
    return true;
  }

  override scroll(paneID: string, deltaY: number, precise: boolean): boolean {
    this.scrolls.push({ paneID, deltaY, precise });
    return true;
  }

  override snapshot(paneID: string): { paneID: string; content: string } | undefined {
    return { paneID, content: "snapshot" };
  }
}

class BufferedTerminalManager extends TerminalManager {
  override content(): string[] | undefined {
    return ["hello mobile"];
  }
}

async function pair(router: MobileRouter): Promise<void> {
  await router.process({
    id: "pair",
    method: "pairDevice",
    params: { type: "pairDevice", value: { deviceID, deviceName: "iPhone", token: "secret" } }
  }, clientID);
}

function countAreas(node: SplitNodeDTO): number {
  if (node.type === "tabArea") return 1;
  return countAreas(node.split.first) + countAreas(node.split.second);
}
