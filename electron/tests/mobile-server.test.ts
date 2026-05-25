import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import WebSocket from "ws";
import { AppModel } from "../src/main/state/AppModel.js";
import { MobileDeviceStore } from "../src/main/mobile/MobileDeviceStore.js";
import { MobileRouter } from "../src/main/mobile/MobileRouter.js";
import { MobileServer } from "../src/main/mobile/MobileServer.js";
import { ProjectLogoStore } from "../src/main/projects/ProjectLogoStore.js";
import { TerminalManager } from "../src/main/terminal/TerminalManager.js";
import { GitService } from "../src/main/vcs/GitService.js";
import { decodeMessage, encodeMessage, type SamuxyMessage, type SamuxyResponse } from "../src/shared/protocol.js";
import type { VCSMergeMethod } from "../src/shared/protocol.js";

let server: MobileServer | undefined;
const tempRoots: string[] = [];

afterEach(async () => {
  await server?.stop();
  server = undefined;
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("mobile websocket server", () => {
  it("accepts a mobile pairing request over WebSocket", async () => {
    const port = 55000 + Math.floor(Math.random() * 1000);
    const router = new MobileRouter(new AppModel(process.cwd()), new MobileDeviceStore(), new TerminalManager());
    server = new MobileServer(router, port);
    await server.start();
    const socket = new WebSocket(`ws://127.0.0.1:${port}`);
    await onceOpen(socket);
    const response = await request(socket, {
      type: "request",
      payload: {
        id: "pair",
        method: "pairDevice",
        params: {
          type: "pairDevice",
          value: {
            deviceID: "b8b819d9-e5ad-42e6-b473-7d853390b8c1",
            deviceName: "Android",
            token: "token"
          }
        }
      }
    });
    socket.close();
    expect(response.type).toBe("response");
    if (response.type !== "response") throw new Error("Expected response");
    expect(response.payload.result?.type).toBe("pairing");
  });

  it("broadcasts terminal output only after mobile authentication", async () => {
    const port = 56000 + Math.floor(Math.random() * 1000);
    const router = new MobileRouter(new AppModel(process.cwd()), new MobileDeviceStore(), new TerminalManager());
    server = new MobileServer(router, port);
    await server.start();
    const socket = new WebSocket(`ws://127.0.0.1:${port}`);
    await onceOpen(socket);
    await request(socket, {
      type: "request",
      payload: {
        id: "pair",
        method: "pairDevice",
        params: {
          type: "pairDevice",
          value: {
            deviceID: "cf6213e6-459e-4794-929d-01bcd99f539c",
            deviceName: "iPhone",
            token: "token"
          }
        }
      }
    });
    const eventPromise = nextMessage(socket);
    server.broadcast({
      event: "terminalOutput",
      data: {
        type: "terminalOutput",
        value: {
          paneID: "2083cb7d-1761-4e5d-bf54-3decd261084e",
          bytes: Buffer.from("hello", "utf8").toString("base64")
        }
      }
    });
    const event = await eventPromise;
    socket.close();
    expect(event.type).toBe("event");
    if (event.type !== "event") throw new Error("Expected event");
    expect(event.payload.event).toBe("terminalOutput");
    expect(event.payload.data.type).toBe("terminalOutput");
  });

  it("runs a mobile client workflow over WebSocket", async () => {
    const root = makeTempRoot();
    const logos = path.join(root, "logos");
    fs.mkdirSync(logos);
    fs.writeFileSync(path.join(root, "README.md"), "# samuxy mobile websocket\n", "utf8");
    fs.writeFileSync(path.join(logos, "project.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    const model = new AppModel(root);
    const project = model.listProjects()[0];
    model.setProjectLogo(project.id, "project.png");
    const terminals = new RecordingTerminalManager();
    const git = new RecordingGitService();
    const router = new MobileRouter(
      model,
      new MobileDeviceStore(),
      terminals,
      undefined,
      git,
      undefined,
      new ProjectLogoStore(logos)
    );
    const port = 57000 + Math.floor(Math.random() * 1000);
    server = new MobileServer(router, port);
    router.on("event", (event) => server?.broadcast(event));
    await server.start();
    const socket = new WebSocket(`ws://127.0.0.1:${port}`);
    await onceOpen(socket);

    await expectResult(socket, {
      type: "request",
      payload: {
        id: "pair",
        method: "pairDevice",
        params: {
          type: "pairDevice",
          value: {
            deviceID: "7d9a4420-9564-46dc-ae9a-f745ec8f514f",
            deviceName: "Android",
            token: "token"
          }
        }
      }
    }, "pairing");

    const projects = await expectResult(socket, { type: "request", payload: { id: "projects", method: "listProjects" } }, "projects");
    if (projects.payload.result?.type !== "projects") throw new Error("Expected projects");
    expect(projects.payload.result.value[0].id).toBe(project.id);

    const workspace = await expectResult(socket, {
      type: "request",
      payload: {
        id: "workspace",
        method: "getWorkspace",
        params: { type: "getWorkspace", value: { projectID: project.id } }
      }
    }, "workspace");
    if (workspace.payload.result?.type !== "workspace" || workspace.payload.result.value.root.type !== "tabArea") {
      throw new Error("Expected tab area workspace");
    }
    const areaID = workspace.payload.result.value.root.tabArea.id;
    const paneID = workspace.payload.result.value.root.tabArea.tabs[0].paneID;
    if (!paneID) throw new Error("Expected terminal pane");

    await expectResult(socket, {
      type: "request",
      payload: {
        id: "logo",
        method: "getProjectLogo",
        params: { type: "getProjectLogo", value: { projectID: project.id } }
      }
    }, "projectLogo");

    const read = await expectResult(socket, {
      type: "request",
      payload: {
        id: "read",
        method: "readFile",
        params: { type: "readFile", value: { projectID: project.id, filePath: "README.md" } }
      }
    }, "textFile");
    if (read.payload.result?.type !== "textFile") throw new Error("Expected textFile");
    expect(read.payload.result.value.content).toContain("websocket");

    const splitEvent = nextEvent(socket, "workspaceChanged");
    await expectResult(socket, {
      type: "request",
      payload: {
        id: "split",
        method: "splitArea",
        params: { type: "splitArea", value: { projectID: project.id, areaID, direction: "horizontal", position: "second" } }
      }
    }, "ok");
    expect((await splitEvent).payload.data.type).toBe("workspace");

    const ownershipEvent = nextEvent(socket, "paneOwnershipChanged");
    await expectResult(socket, {
      type: "request",
      payload: {
        id: "takeover",
        method: "takeOverPane",
        params: { type: "takeOverPane", value: { paneID, cols: 100, rows: 30 } }
      }
    }, "ok");
    const ownership = await ownershipEvent;
    expect(ownership.payload.data.type).toBe("paneOwnership");

    await expectResult(socket, {
      type: "request",
      payload: {
        id: "terminal-input",
        method: "terminalInput",
        params: { type: "terminalInput", value: { paneID, bytes: Buffer.from("pwd\n").toString("base64") } }
      }
    }, "ok");
    expect(terminals.writes).toEqual([{ paneID, bytes: Buffer.from("pwd\n").toString("base64") }]);

    await expectResult(socket, {
      type: "request",
      payload: {
        id: "status",
        method: "getVCSStatus",
        params: { type: "getVCSStatus", value: { projectID: project.id } }
      }
    }, "vcsStatus");

    const worktrees = await expectResult(socket, {
      type: "request",
      payload: {
        id: "add-worktree",
        method: "vcsAddWorktree",
        params: { type: "vcsAddWorktree", value: { projectID: project.id, name: "feature-wt", branch: "feature/mobile", createBranch: true, baseBranch: "main" } }
      }
    }, "worktrees");
    if (worktrees.payload.result?.type !== "worktrees") throw new Error("Expected worktrees");
    expect(worktrees.payload.result.value).toHaveLength(2);

    socket.close();
  });
});

function onceOpen(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("error", reject);
  });
}

function request(socket: WebSocket, message: SamuxyMessage): Promise<SamuxyMessage> {
  return new Promise((resolve, reject) => {
    const requestID = message.type === "request" ? message.payload.id : undefined;
    const onMessage = (data: WebSocket.RawData) => {
      const received = decodeMessage(data.toString());
      if (received.type !== "response" || (requestID && received.payload.id !== requestID)) return;
      socket.off("message", onMessage);
      socket.off("error", onError);
      resolve(received);
    };
    const onError = (error: Error) => {
      socket.off("message", onMessage);
      reject(error);
    };
    socket.on("message", onMessage);
    socket.once("error", onError);
    socket.send(encodeMessage(message));
  });
}

function nextMessage(socket: WebSocket): Promise<SamuxyMessage> {
  return new Promise((resolve, reject) => {
    socket.once("message", (data) => resolve(decodeMessage(data.toString())));
    socket.once("error", reject);
  });
}

async function expectResult(socket: WebSocket, message: SamuxyMessage, type: NonNullable<SamuxyResponse["result"]>["type"]): Promise<SamuxyMessage & { type: "response" }> {
  const response = await request(socket, message);
  expect(response.type).toBe("response");
  if (response.type !== "response") throw new Error("Expected response");
  expect(response.payload.result?.type).toBe(type);
  return response;
}

function nextEvent(socket: WebSocket, eventName: string): Promise<SamuxyMessage & { type: "event" }> {
  return new Promise((resolve, reject) => {
    const onMessage = (data: WebSocket.RawData) => {
      const message = decodeMessage(data.toString());
      if (message.type === "event" && message.payload.event === eventName) {
        socket.off("message", onMessage);
        socket.off("error", onError);
        resolve(message);
      }
    };
    const onError = (error: Error) => {
      socket.off("message", onMessage);
      reject(error);
    };
    socket.on("message", onMessage);
    socket.once("error", onError);
  });
}

function makeTempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "samuxy-mobile-ws-"));
  tempRoots.push(root);
  return root;
}

class RecordingTerminalManager extends TerminalManager {
  readonly writes: Array<{ paneID: string; bytes: string }> = [];

  override create(): void {}

  override resize(): boolean {
    return true;
  }

  override write(paneID: string, bytes: string): boolean {
    this.writes.push({ paneID, bytes });
    return true;
  }

  override snapshot(paneID: string): { paneID: string; content: string } | undefined {
    return { paneID, content: "snapshot" };
  }
}

class RecordingGitService extends GitService {
  override async status() {
    return {
      branch: "main",
      aheadCount: 0,
      behindCount: 0,
      hasUpstream: false,
      stagedFiles: [],
      changedFiles: [],
      defaultBranch: "main"
    };
  }

  override async addWorktree(cwd: string, name: string, branch: string) {
    return path.join(path.dirname(cwd), name);
  }

  override async createPR() {
    return { url: "https://github.com/samuxy/samuxy/pull/42", number: 42 };
  }

  override async mergePR(_cwd: string, _number: number, _method: VCSMergeMethod, _deleteBranch: boolean) {}
}
