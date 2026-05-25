import { EventEmitter } from "node:events";
import type { WebSocket } from "ws";
import { AppModel } from "../state/AppModel.js";
import { MobileDeviceStore } from "./MobileDeviceStore.js";
import { TerminalManager } from "../terminal/TerminalManager.js";
import { encodeMessage, SamuxyErrors, type SamuxyEvent, type SamuxyRequest, type SamuxyResponse, type PaneOwnerDTO, type TerminalCellsDTO } from "../../shared/protocol.js";
import { GitService, type GitClient } from "../vcs/GitService.js";
import { FileService } from "../files/FileService.js";
import { NotificationStore } from "../notifications/NotificationStore.js";
import { AIUsageService } from "../ai/AIUsageService.js";
import { ProjectLogoStore } from "../projects/ProjectLogoStore.js";

export class MobileRouter extends EventEmitter {
  private readonly authenticatedClients = new Set<string>();
  private readonly deviceByClient = new Map<string, string>();
  private readonly paneOwners = new Map<string, PaneOwnerDTO>();

  constructor(
    private readonly model: AppModel,
    private readonly devices: MobileDeviceStore,
    private readonly terminals: TerminalManager,
    private readonly notifications = new NotificationStore(),
    private readonly git: GitClient = new GitService(),
    private readonly aiUsage = new AIUsageService(),
    private readonly projectLogos = new ProjectLogoStore("")
  ) {
    super();
  }

  async process(request: SamuxyRequest, clientID: string): Promise<SamuxyResponse> {
    if (request.method === "pairDevice") {
      if (request.params?.type !== "pairDevice") return { id: request.id, error: SamuxyErrors.invalidParams };
      const { deviceID, token, deviceName } = request.params.value;
      this.devices.approve(deviceID, token, deviceName);
      this.authenticatedClients.add(clientID);
      this.deviceByClient.set(clientID, deviceID);
      return { id: request.id, result: { type: "pairing", value: { clientID, deviceName } } };
    }

    if (request.method === "authenticateDevice") {
      if (request.params?.type !== "authenticateDevice") return { id: request.id, error: SamuxyErrors.invalidParams };
      const { deviceID, token, deviceName } = request.params.value;
      const decision = this.devices.authenticate(deviceID, token);
      if (decision !== "approved") return { id: request.id, error: SamuxyErrors.unauthorized };
      this.authenticatedClients.add(clientID);
      this.deviceByClient.set(clientID, deviceID);
      return { id: request.id, result: { type: "pairing", value: { clientID, deviceName: this.devices.nameFor(deviceID) ?? deviceName } } };
    }

    if (!this.authenticatedClients.has(clientID)) {
      return { id: request.id, error: SamuxyErrors.unauthorized };
    }

    switch (request.method) {
      case "listProjects":
        return { id: request.id, result: { type: "projects", value: this.model.listProjects() } };
      case "listWorktrees":
        if (request.params?.type !== "listWorktrees") return { id: request.id, error: SamuxyErrors.invalidParams };
        return { id: request.id, result: { type: "worktrees", value: this.model.listWorktrees(request.params.value.projectID) } };
      case "selectProject":
        if (request.params?.type !== "selectProject") return { id: request.id, error: SamuxyErrors.invalidParams };
        return this.okOrNotFound(request.id, this.model.selectProject(request.params.value.projectID));
      case "selectWorktree":
        if (request.params?.type !== "selectWorktree") return { id: request.id, error: SamuxyErrors.invalidParams };
        {
          const ok = this.model.selectWorktree(request.params.value.projectID, request.params.value.worktreeID);
          if (ok) this.broadcastWorkspace(request.params.value.projectID);
          return this.okOrNotFound(request.id, ok);
        }
      case "getWorkspace":
        if (request.params?.type !== "getWorkspace") return { id: request.id, error: SamuxyErrors.invalidParams };
        return this.withValue(request.id, "workspace", this.model.getWorkspace(request.params.value.projectID));
      case "createTab":
        if (request.params?.type !== "createTab") return { id: request.id, error: SamuxyErrors.invalidParams };
        {
          const tab = this.model.createTab(request.params.value.projectID, request.params.value.areaID, request.params.value.kind);
          if (tab?.paneID) {
            const descriptor = this.model.terminalSessionFor(request.params.value.projectID, tab.paneID);
            if (descriptor) this.terminals.create(descriptor);
          }
          return this.withValue(request.id, "tab", tab);
        }
      case "selectTab":
        if (request.params?.type !== "selectTab") return { id: request.id, error: SamuxyErrors.invalidParams };
        return this.okOrNotFound(request.id, this.model.selectTab(request.params.value.projectID, request.params.value.areaID, request.params.value.tabID));
      case "closeTab":
        if (request.params?.type !== "closeTab") return { id: request.id, error: SamuxyErrors.invalidParams };
        return this.okOrNotFound(request.id, this.model.closeTab(request.params.value.projectID, request.params.value.areaID, request.params.value.tabID));
      case "splitArea":
        if (request.params?.type !== "splitArea") return { id: request.id, error: SamuxyErrors.invalidParams };
        {
          const descriptor = this.model.splitArea(
            request.params.value.projectID,
            request.params.value.areaID,
            request.params.value.direction,
            request.params.value.position
          );
          if (!descriptor) return { id: request.id, error: SamuxyErrors.notFound };
          this.terminals.create(descriptor);
          this.broadcastWorkspace(request.params.value.projectID);
          return { id: request.id, result: { type: "ok" } };
        }
      case "closeArea":
        if (request.params?.type !== "closeArea") return { id: request.id, error: SamuxyErrors.invalidParams };
        {
          const result = this.model.closeArea(request.params.value.projectID, request.params.value.areaID);
          if (!result.ok) return { id: request.id, error: SamuxyErrors.notFound };
          for (const paneID of result.closedPaneIDs) {
            this.terminals.close(paneID);
            this.paneOwners.delete(paneID);
          }
          this.broadcastWorkspace(request.params.value.projectID);
          return { id: request.id, result: { type: "ok" } };
        }
      case "focusArea":
        if (request.params?.type !== "focusArea") return { id: request.id, error: SamuxyErrors.invalidParams };
        return this.okOrNotFound(request.id, this.model.focusArea(request.params.value.projectID, request.params.value.areaID));
      case "terminalInput":
        if (request.params?.type !== "terminalInput") return { id: request.id, error: SamuxyErrors.invalidParams };
        if (!this.isOwnedByClient(request.params.value.paneID, clientID)) return { id: request.id, error: SamuxyErrors.unauthorized };
        return this.okOrNotFound(request.id, this.terminals.write(request.params.value.paneID, request.params.value.bytes));
      case "terminalResize":
        if (request.params?.type !== "terminalResize") return { id: request.id, error: SamuxyErrors.invalidParams };
        if (!this.isOwnedByClient(request.params.value.paneID, clientID)) return { id: request.id, error: SamuxyErrors.unauthorized };
        return this.okOrNotFound(request.id, this.terminals.resize(request.params.value.paneID, request.params.value.cols, request.params.value.rows));
      case "getTerminalContent":
        if (request.params?.type !== "getTerminalContent") return { id: request.id, error: SamuxyErrors.invalidParams };
        return this.withValue(request.id, "terminalCells", makeTerminalCells(
          request.params.value.paneID,
          this.terminals.content(request.params.value.paneID)?.join("") ?? ""
        ));
      case "registerDevice":
        if (request.params?.type !== "registerDevice") return { id: request.id, error: SamuxyErrors.invalidParams };
        return { id: request.id, result: { type: "deviceInfo", value: { clientID, deviceName: request.params.value.deviceName } } };
      case "takeOverPane":
        if (request.params?.type !== "takeOverPane") return { id: request.id, error: SamuxyErrors.invalidParams };
        return this.takeOverPane(request.id, clientID, request.params.value.paneID, request.params.value.cols, request.params.value.rows);
      case "releasePane":
        if (request.params?.type !== "releasePane") return { id: request.id, error: SamuxyErrors.invalidParams };
        return this.releasePane(request.id, clientID, request.params.value.paneID);
      case "listNotifications":
        return { id: request.id, result: { type: "notifications", value: this.notifications.list() } };
      case "terminalScroll":
        if (request.params?.type !== "terminalScroll") return { id: request.id, error: SamuxyErrors.invalidParams };
        if (!this.isOwnedByClient(request.params.value.paneID, clientID)) return { id: request.id, error: SamuxyErrors.unauthorized };
        return this.okOrNotFound(
          request.id,
          this.terminals.scroll(request.params.value.paneID, request.params.value.deltaY, request.params.value.precise)
        );
      case "subscribe":
      case "unsubscribe":
        return { id: request.id, result: { type: "ok" } };
      case "getVCSStatus":
      case "vcsRefresh":
        if (request.params?.type !== request.method) return { id: request.id, error: SamuxyErrors.invalidParams };
        return this.vcsStatus(request.id, request.params.value.projectID);
      case "vcsListBranches":
        if (request.params?.type !== "vcsListBranches") return { id: request.id, error: SamuxyErrors.invalidParams };
        return this.vcsBranches(request.id, request.params.value.projectID);
      case "vcsStageFiles":
        if (request.params?.type !== "vcsStageFiles") return { id: request.id, error: SamuxyErrors.invalidParams };
        {
          const params = request.params.value;
          return this.vcsCommand(request.id, params.projectID, (cwd) => this.git.stage(cwd, params.paths));
        }
      case "vcsUnstageFiles":
        if (request.params?.type !== "vcsUnstageFiles") return { id: request.id, error: SamuxyErrors.invalidParams };
        {
          const params = request.params.value;
          return this.vcsCommand(request.id, params.projectID, (cwd) => this.git.unstage(cwd, params.paths));
        }
      case "vcsDiscardFiles":
        if (request.params?.type !== "vcsDiscardFiles") return { id: request.id, error: SamuxyErrors.invalidParams };
        {
          const params = request.params.value;
          return this.vcsCommand(request.id, params.projectID, (cwd) => this.git.discard(cwd, params.paths, params.untrackedPaths));
        }
      case "vcsCommit":
        if (request.params?.type !== "vcsCommit") return { id: request.id, error: SamuxyErrors.invalidParams };
        {
          const params = request.params.value;
          return this.vcsCommand(request.id, params.projectID, (cwd) => this.git.commit(cwd, params.message, params.stageAll));
        }
      case "vcsPull":
        if (request.params?.type !== "vcsPull") return { id: request.id, error: SamuxyErrors.invalidParams };
        return this.vcsCommand(request.id, request.params.value.projectID, (cwd) => this.git.pull(cwd));
      case "vcsPush":
        if (request.params?.type !== "vcsPush") return { id: request.id, error: SamuxyErrors.invalidParams };
        return this.vcsCommand(request.id, request.params.value.projectID, (cwd) => this.git.push(cwd));
      case "vcsSwitchBranch":
        if (request.params?.type !== "vcsSwitchBranch") return { id: request.id, error: SamuxyErrors.invalidParams };
        {
          const params = request.params.value;
          return this.vcsCommand(request.id, params.projectID, (cwd) => this.git.switchBranch(cwd, params.branch));
        }
      case "vcsCreateBranch":
        if (request.params?.type !== "vcsCreateBranch") return { id: request.id, error: SamuxyErrors.invalidParams };
        {
          const params = request.params.value;
          return this.vcsCommand(request.id, params.projectID, (cwd) => this.git.createBranch(cwd, params.name));
        }
      case "vcsCreatePR":
        if (request.params?.type !== "vcsCreatePR") return { id: request.id, error: SamuxyErrors.invalidParams };
        return this.vcsCreatePR(
          request.id,
          request.params.value.projectID,
          request.params.value.title,
          request.params.value.body,
          request.params.value.baseBranch,
          request.params.value.draft
        );
      case "vcsMergePullRequest":
        if (request.params?.type !== "vcsMergePullRequest") return { id: request.id, error: SamuxyErrors.invalidParams };
        {
          const params = request.params.value;
          return this.vcsCommand(
            request.id,
            params.projectID,
            (cwd) => this.git.mergePR(cwd, params.number, params.method, params.deleteBranch)
          );
        }
      case "vcsAddWorktree":
        if (request.params?.type !== "vcsAddWorktree") return { id: request.id, error: SamuxyErrors.invalidParams };
        return this.vcsAddWorktree(
          request.id,
          request.params.value.projectID,
          request.params.value.name,
          request.params.value.branch,
          request.params.value.createBranch,
          request.params.value.baseBranch
        );
      case "vcsRemoveWorktree":
        if (request.params?.type !== "vcsRemoveWorktree") return { id: request.id, error: SamuxyErrors.invalidParams };
        return this.vcsRemoveWorktree(request.id, request.params.value.projectID, request.params.value.worktreeID);
      case "vcsGetDiff":
        if (request.params?.type !== "vcsGetDiff") return { id: request.id, error: SamuxyErrors.invalidParams };
        return this.vcsDiff(request.id, request.params.value.projectID, request.params.value.filePath);
      case "getProjectLogo":
        if (request.params?.type !== "getProjectLogo") return { id: request.id, error: SamuxyErrors.invalidParams };
        return this.getProjectLogo(request.id, request.params.value.projectID);
      case "listFiles":
        if (request.params?.type !== "listFiles") return { id: request.id, error: SamuxyErrors.invalidParams };
        return this.fileTree(request.id, request.params.value.projectID);
      case "readFile":
        if (request.params?.type !== "readFile") return { id: request.id, error: SamuxyErrors.invalidParams };
        return this.readFile(request.id, request.params.value.projectID, request.params.value.filePath);
      case "writeFile":
        if (request.params?.type !== "writeFile") return { id: request.id, error: SamuxyErrors.invalidParams };
        return this.writeFile(request.id, request.params.value.projectID, request.params.value.filePath, request.params.value.content);
      case "searchFiles":
        if (request.params?.type !== "searchFiles") return { id: request.id, error: SamuxyErrors.invalidParams };
        return this.searchFiles(request.id, request.params.value.projectID, request.params.value.query);
      case "listAIUsage":
        return this.listAIUsage(request.id);
      case "markNotificationRead":
        if (request.params?.type !== "markNotificationRead") return { id: request.id, error: SamuxyErrors.invalidParams };
        return this.okOrNotFound(request.id, this.notifications.markRead(request.params.value.notificationID));
    }
  }

  removeClient(clientID: string): void {
    this.authenticatedClients.delete(clientID);
    this.deviceByClient.delete(clientID);
    for (const [paneID, owner] of this.paneOwners) {
      if (owner.type === "remote" && owner.value.deviceID === clientID) {
        this.releaseToWindows(paneID);
      }
    }
  }

  isAuthenticated(clientID: string): boolean {
    return this.authenticatedClients.has(clientID);
  }

  paneOwner(paneID: string): PaneOwnerDTO {
    return this.paneOwners.get(paneID) ?? { type: "windows", value: { deviceName: "samuxy" } };
  }

  isPaneOwnedByRemote(paneID: string): boolean {
    return this.paneOwner(paneID).type === "remote";
  }

  takeOverPaneOnDesktop(paneID: string): PaneOwnerDTO | undefined {
    if (!this.terminals.has(paneID)) return undefined;
    this.releaseToWindows(paneID);
    return this.paneOwner(paneID);
  }

  send(socket: WebSocket, response: SamuxyResponse): void {
    socket.send(encodeMessage({ type: "response", payload: response }));
  }

  private withValue<Type extends "workspace" | "tab" | "terminalCells">(id: string, type: Type, value: Extract<NonNullable<SamuxyResponse["result"]>, { type: Type }>["value"] | undefined): SamuxyResponse {
    if (!value) return { id, error: SamuxyErrors.notFound };
    return { id, result: { type, value } as NonNullable<SamuxyResponse["result"]> };
  }

  private okOrNotFound(id: string, ok: boolean): SamuxyResponse {
    return ok ? { id, result: { type: "ok" } } : { id, error: SamuxyErrors.notFound };
  }

  private async vcsStatus(id: string, projectID: string): Promise<SamuxyResponse> {
    const cwd = this.model.projectPath(projectID);
    if (!cwd) return { id, error: SamuxyErrors.notFound };
    try {
      return { id, result: { type: "vcsStatus", value: await this.git.status(cwd) } };
    } catch (error) {
      return { id, error: { code: 500, message: (error as Error).message } };
    }
  }

  private async vcsBranches(id: string, projectID: string): Promise<SamuxyResponse> {
    const cwd = this.model.projectPath(projectID);
    if (!cwd) return { id, error: SamuxyErrors.notFound };
    try {
      return { id, result: { type: "vcsBranches", value: await this.git.branches(cwd) } };
    } catch (error) {
      return { id, error: { code: 500, message: (error as Error).message } };
    }
  }

  private async vcsDiff(id: string, projectID: string, filePath: string): Promise<SamuxyResponse> {
    const cwd = this.model.projectPath(projectID);
    if (!cwd) return { id, error: SamuxyErrors.notFound };
    try {
      return { id, result: { type: "vcsDiff", value: await this.git.diff(cwd, filePath) } };
    } catch (error) {
      return { id, error: { code: 500, message: (error as Error).message } };
    }
  }

  private async vcsCreatePR(
    id: string,
    projectID: string,
    title: string,
    body: string,
    baseBranch: string | undefined,
    draft: boolean
  ): Promise<SamuxyResponse> {
    const cwd = this.model.projectPath(projectID);
    if (!cwd) return { id, error: SamuxyErrors.notFound };
    try {
      return { id, result: { type: "vcsPRCreated", value: await this.git.createPR(cwd, title, body, baseBranch, draft) } };
    } catch (error) {
      return { id, error: { code: 500, message: (error as Error).message } };
    }
  }

  private async vcsCommand(id: string, projectID: string, action: (cwd: string) => Promise<void>): Promise<SamuxyResponse> {
    const cwd = this.model.projectPath(projectID);
    if (!cwd) return { id, error: SamuxyErrors.notFound };
    try {
      await action(cwd);
      return { id, result: { type: "ok" } };
    } catch (error) {
      return { id, error: { code: 500, message: (error as Error).message } };
    }
  }

  private async vcsAddWorktree(
    id: string,
    projectID: string,
    name: string,
    branch: string,
    createBranch: boolean,
    baseBranch: string | undefined
  ): Promise<SamuxyResponse> {
    const cwd = this.model.projectPath(projectID);
    if (!cwd) return { id, error: SamuxyErrors.notFound };
    try {
      const worktreePath = await this.git.addWorktree(cwd, name, branch, createBranch, baseBranch);
      this.model.addWorktree(projectID, name, worktreePath, branch);
      this.emitEvent({ event: "projectsChanged", data: { type: "projects", value: this.model.listProjects() } });
      return { id, result: { type: "worktrees", value: this.model.listWorktrees(projectID) } };
    } catch (error) {
      return { id, error: { code: 500, message: (error as Error).message } };
    }
  }

  private async vcsRemoveWorktree(id: string, projectID: string, worktreeID: string): Promise<SamuxyResponse> {
    const cwd = this.model.projectPath(projectID);
    const worktreePath = this.model.worktreePath(projectID, worktreeID);
    if (!cwd || !worktreePath) return { id, error: SamuxyErrors.notFound };
    try {
      await this.git.removeWorktree(cwd, worktreePath);
      const removed = this.model.removeWorktree(projectID, worktreeID);
      if (!removed) return { id, error: SamuxyErrors.notFound };
      this.broadcastWorkspace(projectID);
      this.emitEvent({ event: "projectsChanged", data: { type: "projects", value: this.model.listProjects() } });
      return { id, result: { type: "ok" } };
    } catch (error) {
      return { id, error: { code: 500, message: (error as Error).message } };
    }
  }

  private async fileTree(id: string, projectID: string): Promise<SamuxyResponse> {
    const projectPath = this.model.projectPath(projectID);
    if (!projectPath) return { id, error: SamuxyErrors.notFound };
    try {
      return { id, result: { type: "fileTree", value: await new FileService(projectPath).tree() } };
    } catch (error) {
      return { id, error: { code: 500, message: (error as Error).message } };
    }
  }

  private async readFile(id: string, projectID: string, filePath: string): Promise<SamuxyResponse> {
    const projectPath = this.model.projectPath(projectID);
    if (!projectPath) return { id, error: SamuxyErrors.notFound };
    try {
      return { id, result: { type: "textFile", value: await new FileService(projectPath).readText(filePath) } };
    } catch (error) {
      return { id, error: { code: 500, message: (error as Error).message } };
    }
  }

  private async writeFile(id: string, projectID: string, filePath: string, content: string): Promise<SamuxyResponse> {
    const projectPath = this.model.projectPath(projectID);
    if (!projectPath) return { id, error: SamuxyErrors.notFound };
    try {
      return { id, result: { type: "textFile", value: await new FileService(projectPath).writeText(filePath, content) } };
    } catch (error) {
      return { id, error: { code: 500, message: (error as Error).message } };
    }
  }

  private async searchFiles(id: string, projectID: string, query: string): Promise<SamuxyResponse> {
    const projectPath = this.model.projectPath(projectID);
    if (!projectPath) return { id, error: SamuxyErrors.notFound };
    try {
      return { id, result: { type: "fileSearch", value: await new FileService(projectPath).search(query) } };
    } catch (error) {
      return { id, error: { code: 500, message: (error as Error).message } };
    }
  }

  private async listAIUsage(id: string): Promise<SamuxyResponse> {
    try {
      return { id, result: { type: "aiUsage", value: await this.aiUsage.snapshots() } };
    } catch (error) {
      return { id, error: { code: 500, message: (error as Error).message } };
    }
  }

  private async getProjectLogo(id: string, projectID: string): Promise<SamuxyResponse> {
    try {
      const logo = await this.projectLogos.get(projectID, this.model.projectLogo(projectID));
      if (!logo) return { id, error: SamuxyErrors.notFound };
      return { id, result: { type: "projectLogo", value: logo } };
    } catch (error) {
      return { id, error: { code: 500, message: (error as Error).message } };
    }
  }

  private takeOverPane(id: string, clientID: string, paneID: string, cols: number, rows: number): SamuxyResponse {
    if (!this.terminals.resize(paneID, cols, rows)) return { id, error: SamuxyErrors.notFound };
    const deviceID = this.deviceByClient.get(clientID) ?? clientID;
    const owner: PaneOwnerDTO = {
      type: "remote",
      value: {
        deviceID: clientID,
        deviceName: this.devices.nameFor(deviceID) ?? "Mobile"
      }
    };
    this.paneOwners.set(paneID, owner);
    this.emitPaneOwnership(paneID, owner);
    const snapshot = this.terminals.snapshot(paneID);
    if (snapshot) {
      this.emitEvent({
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
    return { id, result: { type: "ok" } };
  }

  private releasePane(id: string, clientID: string, paneID: string): SamuxyResponse {
    if (!this.isOwnedByClient(paneID, clientID)) return { id, error: SamuxyErrors.unauthorized };
    this.releaseToWindows(paneID);
    return { id, result: { type: "ok" } };
  }

  private releaseToWindows(paneID: string): void {
    const owner: PaneOwnerDTO = { type: "windows", value: { deviceName: "samuxy" } };
    this.paneOwners.set(paneID, owner);
    this.emitPaneOwnership(paneID, owner);
  }

  private isOwnedByClient(paneID: string, clientID: string): boolean {
    const owner = this.paneOwners.get(paneID);
    return owner?.type === "remote" && owner.value.deviceID === clientID;
  }

  private broadcastWorkspace(projectID: string): void {
    const workspace = this.model.getWorkspace(projectID);
    if (!workspace) return;
    this.emitEvent({ event: "workspaceChanged", data: { type: "workspace", value: workspace } });
  }

  private emitPaneOwnership(paneID: string, owner: PaneOwnerDTO): void {
    this.emitEvent({ event: "paneOwnershipChanged", data: { type: "paneOwnership", value: { paneID, owner } } });
  }

  private emitEvent(event: SamuxyEvent): void {
    this.emit("event", event);
  }
}

function makeTerminalCells(paneID: string, content: string): TerminalCellsDTO {
  const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const visible = normalized.split("\n").slice(-24).join("\n");
  const cells = [...visible].slice(-80 * 24).map((char) => ({
    codepoint: char.codePointAt(0) ?? 32,
    fg: 0xeeeeee,
    bg: 0x101010,
    flags: 0
  }));
  return {
    paneID,
    cols: 80,
    rows: 24,
    cursorX: 0,
    cursorY: Math.min(23, visible.split("\n").length - 1),
    cursorVisible: true,
    defaultFg: 0xeeeeee,
    defaultBg: 0x101010,
    cells,
    altScreen: false,
    cursorKeys: false,
    bracketedPaste: false,
    focusEvent: false,
    mouseEvent: 0,
    mouseFormat: 0
  };
}
