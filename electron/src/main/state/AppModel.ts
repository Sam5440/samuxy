import crypto from "node:crypto";
import path from "node:path";
import type { ProjectDTO, SplitDirection, SplitNodeDTO, TabAreaDTO, TabDTO, TabMergeLayout, WorktreeDTO, WorkspaceDTO } from "../../shared/protocol.js";
import { JSONFileStore } from "../storage/JSONFileStore.js";

const now = () => new Date().toISOString();
const id = () => crypto.randomUUID();

export interface AppModelSnapshot {
  projects: ProjectDTO[];
  worktrees: Record<string, WorktreeDTO[]>;
  workspaces: Record<string, WorkspaceDTO>;
}

export interface TerminalSessionDescriptor {
  paneID: string;
  title: string;
  cwd: string;
  cols: number;
  rows: number;
}

interface TabRecord {
  tab: TabDTO;
  projectPath: string;
}

export class AppModel {
  private readonly projects: ProjectDTO[] = [];
  private readonly worktrees = new Map<string, WorktreeDTO[]>();
  private readonly workspaces = new Map<string, WorkspaceDTO>();
  private readonly store?: JSONFileStore<AppModelSnapshot>;

  constructor(seedPath = process.cwd(), store?: JSONFileStore<AppModelSnapshot>) {
    this.store = store;
    const restored = store?.read();
    if (restored) {
      this.restore(restored);
    }
    if (this.projects.length === 0) {
      this.addProject(seedPath);
    }
  }

  listProjects(): ProjectDTO[] {
    return [...this.projects].sort((a, b) => a.sortOrder - b.sortOrder);
  }

  addProject(projectPath: string): ProjectDTO {
    const project: ProjectDTO = {
      id: id(),
      name: path.basename(projectPath) || projectPath,
      path: projectPath,
      sortOrder: this.projects.length,
      createdAt: now()
    };
    const worktree: WorktreeDTO = {
      id: id(),
      name: project.name,
      path: projectPath,
      isPrimary: true,
      canBeRemoved: false,
      createdAt: project.createdAt
    };
    const area = this.makeArea(projectPath);
    this.projects.push(project);
    this.worktrees.set(project.id, [worktree]);
    this.workspaces.set(project.id, {
      projectID: project.id,
      worktreeID: worktree.id,
      focusedAreaID: area.id,
      root: { type: "tabArea", tabArea: area }
    });
    this.save();
    return project;
  }

  addWorktree(projectID: string, name: string, worktreePath: string, branch?: string): WorktreeDTO | undefined {
    const project = this.projects.find((item) => item.id === projectID);
    const workspace = this.workspaces.get(projectID);
    if (!project || !workspace) return undefined;
    const worktree: WorktreeDTO = {
      id: id(),
      name,
      path: worktreePath,
      branch,
      isPrimary: false,
      canBeRemoved: true,
      createdAt: now()
    };
    const worktrees = this.worktrees.get(projectID) ?? [];
    worktrees.push(worktree);
    this.worktrees.set(projectID, worktrees);
    this.save();
    return worktree;
  }
  removeProject(projectID: string): boolean {
    const index = this.projects.findIndex((item) => item.id === projectID);
    if (index === -1) return false;
    this.projects.splice(index, 1);
    this.worktrees.delete(projectID);
    this.workspaces.delete(projectID);
    this.save();
    return true;
  }

  removeWorktree(projectID: string, worktreeID: string): WorktreeDTO | undefined {
    const worktrees = this.worktrees.get(projectID);
    if (!worktrees) return undefined;
    const target = worktrees.find((item) => item.id === worktreeID);
    if (!target?.canBeRemoved) return undefined;
    this.worktrees.set(projectID, worktrees.filter((item) => item.id !== worktreeID));
    if (this.workspaces.get(projectID)?.worktreeID === worktreeID) {
      const fallback = this.worktrees.get(projectID)?.find((item) => item.isPrimary) ?? this.worktrees.get(projectID)?.[0];
      if (fallback) this.selectWorktree(projectID, fallback.id);
    }
    this.save();
    return target;
  }

  listWorktrees(projectID: string): WorktreeDTO[] {
    return this.worktrees.get(projectID) ?? [];
  }

  selectProject(projectID: string): boolean {
    return this.projects.some((project) => project.id === projectID);
  }

  selectWorktree(projectID: string, worktreeID: string): boolean {
    const worktree = this.worktrees.get(projectID)?.find((item) => item.id === worktreeID);
    const workspace = this.workspaces.get(projectID);
    if (!worktree || !workspace) return false;
    workspace.worktreeID = worktreeID;
    this.retargetAreas(workspace.root, worktree.path);
    this.save();
    return true;
  }

  getWorkspace(projectID: string): WorkspaceDTO | undefined {
    return this.workspaces.get(projectID);
  }

  projectPath(projectID: string): string | undefined {
    return this.projects.find((project) => project.id === projectID)?.path;
  }

  projectLogo(projectID: string): string | undefined {
    return this.projects.find((project) => project.id === projectID)?.logo;
  }

  setProjectLogo(projectID: string, logo: string | undefined): boolean {
    const project = this.projects.find((item) => item.id === projectID);
    if (!project) return false;
    project.logo = logo;
    this.save();
    return true;
  }

  worktreePath(projectID: string, worktreeID: string): string | undefined {
    return this.worktrees.get(projectID)?.find((worktree) => worktree.id === worktreeID)?.path;
  }

  createTab(projectID: string, areaID: string | undefined, kind: TabDTO["kind"]): TabDTO | undefined {
    const workspace = this.workspaces.get(projectID);
    if (!workspace) return undefined;
    const area = areaID
      ? this.findArea(workspace.root, areaID)
      : this.findArea(workspace.root, this.firstAreaID(workspace.root));
    if (!area) return undefined;
    const tab: TabDTO = {
      id: id(),
      kind,
      title: kind === "terminal" ? "Terminal" : kind,
      isPinned: false,
      paneID: kind === "terminal" ? id() : undefined
    };
    area.tabs.push(tab);
    area.activeTabID = tab.id;
    workspace.focusedAreaID = area.id;
    this.save();
    return tab;
  }

  terminalSessionFor(projectID: string, paneID: string): TerminalSessionDescriptor | undefined {
    const workspace = this.workspaces.get(projectID);
    if (!workspace) return undefined;
    const tab = this.findTab(workspace.root, paneID);
    if (!tab?.paneID) return undefined;
    const area = this.findAreaForPane(workspace.root, paneID);
    return {
      paneID: tab.paneID,
      title: tab.title,
      cwd: area?.projectPath ?? process.cwd(),
      cols: 80,
      rows: 24
    };
  }

  terminalSessions(): TerminalSessionDescriptor[] {
    const sessions: TerminalSessionDescriptor[] = [];
    for (const workspace of this.workspaces.values()) {
      this.collectTerminalSessions(workspace.root, sessions);
    }
    return sessions;
  }

  selectTab(projectID: string, areaID: string, tabID: string): boolean {
    const workspace = this.workspaces.get(projectID);
    const area = workspace ? this.findArea(workspace.root, areaID) : undefined;
    if (!area?.tabs.some((tab) => tab.id === tabID)) return false;
    area.activeTabID = tabID;
    if (workspace) workspace.focusedAreaID = areaID;
    this.save();
    return true;
  }

  closeTab(projectID: string, areaID: string, tabID: string): boolean {
    const workspace = this.workspaces.get(projectID);
    const area = workspace ? this.findArea(workspace.root, areaID) : undefined;
    if (!area) return false;
    const next = area.tabs.filter((tab) => tab.id !== tabID);
    if (next.length === area.tabs.length) return false;
    area.tabs = next;
    area.activeTabID = next.at(-1)?.id;
    this.save();
    return true;
  }

  splitArea(projectID: string, areaID: string, direction: SplitDirection, position: "first" | "second"): TerminalSessionDescriptor | undefined {
    const workspace = this.workspaces.get(projectID);
    if (!workspace) return undefined;
    const target = this.findArea(workspace.root, areaID);
    if (!target) return undefined;
    const newArea = this.makeArea(target.projectPath);
    const split = {
      type: "split" as const,
      split: {
        id: id(),
        direction,
        ratio: 0.5,
        first: position === "first" ? { type: "tabArea" as const, tabArea: newArea } : { type: "tabArea" as const, tabArea: target },
        second: position === "first" ? { type: "tabArea" as const, tabArea: target } : { type: "tabArea" as const, tabArea: newArea }
      }
    };
    workspace.root = this.replaceArea(workspace.root, areaID, split);
    workspace.focusedAreaID = newArea.id;
    this.save();
    const paneID = newArea.tabs[0]?.paneID;
    return paneID ? this.terminalSessionFor(projectID, paneID) : undefined;
  }

  mergeTabs(projectID: string, tabIDs: string[], layout: TabMergeLayout): boolean {
    const workspace = this.workspaces.get(projectID);
    const uniqueTabIDs = [...new Set(tabIDs)];
    if (!workspace || uniqueTabIDs.length < 2 || uniqueTabIDs.length > 3) return false;
    const records = this.collectTabRecords(workspace.root);
    const selected = uniqueTabIDs.map((tabID) => records.find((record) => record.tab.id === tabID));
    if (selected.some((record) => !record)) return false;
    const selectedRecords = selected as TabRecord[];
    const selectedIDs = new Set(uniqueTabIDs);
    const fallbackTabs = records.filter((record) => !selectedIDs.has(record.tab.id)).map((record) => record.tab);
    const areas = selectedRecords.map((record, index) => ({
      id: id(),
      projectPath: record.projectPath,
      tabs: index === 0 ? [record.tab, ...fallbackTabs] : [record.tab],
      activeTabID: record.tab.id
    }));
    workspace.root = this.buildMergedRoot(areas, layout);
    workspace.focusedAreaID = areas[0]?.id;
    this.save();
    return true;
  }

  closeArea(projectID: string, areaID: string): { ok: boolean; closedPaneIDs: string[] } {
    const workspace = this.workspaces.get(projectID);
    if (!workspace || !this.findArea(workspace.root, areaID)) return { ok: false, closedPaneIDs: [] };
    const closedPaneIDs = this.paneIDsForArea(workspace.root, areaID);
    const nextRoot = this.removeArea(workspace.root, areaID);
    if (!nextRoot) {
      this.workspaces.delete(projectID);
      this.save();
      return { ok: true, closedPaneIDs };
    }
    workspace.root = nextRoot;
    workspace.focusedAreaID = this.firstAreaID(nextRoot);
    this.save();
    return { ok: true, closedPaneIDs };
  }

  focusArea(projectID: string, areaID: string): boolean {
    const workspace = this.workspaces.get(projectID);
    if (!workspace || !this.findArea(workspace.root, areaID)) return false;
    workspace.focusedAreaID = areaID;
    this.save();
    return true;
  }

  snapshot(): AppModelSnapshot {
    return {
      projects: this.projects,
      worktrees: Object.fromEntries(this.worktrees),
      workspaces: Object.fromEntries(this.workspaces)
    };
  }

  private restore(snapshot: AppModelSnapshot): void {
    this.projects.splice(0, this.projects.length, ...snapshot.projects);
    this.worktrees.clear();
    this.workspaces.clear();
    for (const [projectID, worktrees] of Object.entries(snapshot.worktrees)) {
      this.worktrees.set(projectID, worktrees);
    }
    for (const [projectID, workspace] of Object.entries(snapshot.workspaces)) {
      this.workspaces.set(projectID, workspace);
    }
  }

  private save(): void {
    this.store?.write(this.snapshot());
  }

  private makeArea(projectPath: string): TabAreaDTO {
    const paneID = id();
    const tab: TabDTO = { id: id(), kind: "terminal", title: "Terminal", isPinned: false, paneID };
    return { id: id(), projectPath, tabs: [tab], activeTabID: tab.id };
  }

  private findArea(node: WorkspaceDTO["root"], areaID?: string): TabAreaDTO | undefined {
    if (node.type === "tabArea") {
      return !areaID || node.tabArea.id === areaID ? node.tabArea : undefined;
    }
    return this.findArea(node.split.first, areaID) ?? this.findArea(node.split.second, areaID);
  }

  private collectTabRecords(node: WorkspaceDTO["root"]): TabRecord[] {
    if (node.type === "tabArea") {
      return node.tabArea.tabs.map((tab) => ({ tab, projectPath: node.tabArea.projectPath }));
    }
    return [...this.collectTabRecords(node.split.first), ...this.collectTabRecords(node.split.second)];
  }

  private buildMergedRoot(areas: TabAreaDTO[], layout: TabMergeLayout): SplitNodeDTO {
    if (areas.length === 2) {
      return {
        type: "split",
        split: {
          id: id(),
          direction: layout === "columns" ? "horizontal" : "vertical",
          ratio: 0.5,
          first: { type: "tabArea", tabArea: areas[0] },
          second: { type: "tabArea", tabArea: areas[1] }
        }
      };
    }
    const direction = layout === "columns" ? "horizontal" : "vertical";
    return {
      type: "split",
      split: {
        id: id(),
        direction,
        ratio: 1 / 3,
        first: { type: "tabArea", tabArea: areas[0] },
        second: {
          type: "split",
          split: {
            id: id(),
            direction,
            ratio: 0.5,
            first: { type: "tabArea", tabArea: areas[1] },
            second: { type: "tabArea", tabArea: areas[2] }
          }
        }
      }
    };
  }

  private replaceArea(node: SplitNodeDTO, areaID: string, replacement: SplitNodeDTO): SplitNodeDTO {
    if (node.type === "tabArea") {
      return node.tabArea.id === areaID ? replacement : node;
    }
    return {
      type: "split",
      split: {
        ...node.split,
        first: this.replaceArea(node.split.first, areaID, replacement),
        second: this.replaceArea(node.split.second, areaID, replacement)
      }
    };
  }

  private removeArea(node: SplitNodeDTO, areaID: string): SplitNodeDTO | undefined {
    if (node.type === "tabArea") {
      return node.tabArea.id === areaID ? undefined : node;
    }
    const first = this.removeArea(node.split.first, areaID);
    const second = this.removeArea(node.split.second, areaID);
    if (!first) return second;
    if (!second) return first;
    return { type: "split", split: { ...node.split, first, second } };
  }

  private firstAreaID(node: SplitNodeDTO): string | undefined {
    if (node.type === "tabArea") return node.tabArea.id;
    return this.firstAreaID(node.split.first) ?? this.firstAreaID(node.split.second);
  }

  private retargetAreas(node: SplitNodeDTO, projectPath: string): void {
    if (node.type === "tabArea") {
      node.tabArea.projectPath = projectPath;
      return;
    }
    this.retargetAreas(node.split.first, projectPath);
    this.retargetAreas(node.split.second, projectPath);
  }

  private paneIDsForArea(node: SplitNodeDTO, areaID: string): string[] {
    const area = this.findArea(node, areaID);
    return area?.tabs.flatMap((tab) => tab.paneID ? [tab.paneID] : []) ?? [];
  }

  private findAreaForPane(node: WorkspaceDTO["root"], paneID: string): TabAreaDTO | undefined {
    if (node.type === "tabArea") {
      return node.tabArea.tabs.some((tab) => tab.paneID === paneID) ? node.tabArea : undefined;
    }
    return this.findAreaForPane(node.split.first, paneID) ?? this.findAreaForPane(node.split.second, paneID);
  }

  private findTab(node: WorkspaceDTO["root"], paneID: string): TabDTO | undefined {
    if (node.type === "tabArea") {
      return node.tabArea.tabs.find((tab) => tab.paneID === paneID);
    }
    return this.findTab(node.split.first, paneID) ?? this.findTab(node.split.second, paneID);
  }
  private collectPaneIDs(node: WorkspaceDTO["root"]): string[] {
    if (node.type === "tabArea") {
      return node.tabArea.tabs.flatMap((tab) => tab.paneID ? [tab.paneID] : []);
    }
    return [...this.collectPaneIDs(node.split.first), ...this.collectPaneIDs(node.split.second)];
  }

  private collectTerminalSessions(node: WorkspaceDTO["root"], sessions: TerminalSessionDescriptor[]): void {
    if (node.type === "tabArea") {
      for (const tab of node.tabArea.tabs) {
        if (tab.kind === "terminal" && tab.paneID) {
          sessions.push({
            paneID: tab.paneID,
            title: tab.title,
            cwd: node.tabArea.projectPath,
            cols: 80,
            rows: 24
          });
        }
      }
      return;
    }
    this.collectTerminalSessions(node.split.first, sessions);
    this.collectTerminalSessions(node.split.second, sessions);
  }
}
