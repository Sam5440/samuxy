import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { MobileDeviceStore } from "../src/main/mobile/MobileDeviceStore.js";
import { MobileRouter } from "../src/main/mobile/MobileRouter.js";
import { AppModel } from "../src/main/state/AppModel.js";
import { TerminalManager } from "../src/main/terminal/TerminalManager.js";
import { GitService } from "../src/main/vcs/GitService.js";
import type { VCSMergeMethod } from "../src/shared/protocol.js";

const tempRoots: string[] = [];
const clientID = "91ac9ea7-9ad9-4143-b1da-ee8b6dc38111";
const deviceID = "a7bb673d-d990-4ad7-b61a-bfcd990f3e7b";

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("GitService", () => {
  it("reports branch and changed files on Windows paths", async () => {
    const repo = makeRepo();
    fs.writeFileSync(path.join(repo, "README.md"), "changed\n", "utf8");
    const status = await new GitService().status(repo);
    expect(status.branch).toBeTruthy();
    expect(status.changedFiles.some((file) => file.path === "README.md")).toBe(true);
  });

  it("lists local branches", async () => {
    const repo = makeRepo();
    execFileSync("git", ["switch", "-c", "feature/windows"], { cwd: repo, stdio: "ignore" });
    const branches = await new GitService().branches(repo);
    expect(branches.current).toBe("feature/windows");
    expect(branches.locals).toContain("feature/windows");
  });

  it("adds and removes git worktrees on Windows paths", async () => {
    const repo = makeRepo();
    execFileSync("git", ["switch", "-c", "release"], { cwd: repo, stdio: "ignore" });
    fs.writeFileSync(path.join(repo, "release.txt"), "release\n", "utf8");
    execFileSync("git", ["add", "release.txt"], { cwd: repo });
    execFileSync("git", ["commit", "-m", "release"], { cwd: repo, stdio: "ignore" });
    execFileSync("git", ["switch", "master"], { cwd: repo, stdio: "ignore" });

    const service = new GitService();
    const worktreePath = await service.addWorktree(repo, "feature-wt", "feature/windows", true, "release");
    expect(fs.existsSync(path.join(worktreePath, "release.txt"))).toBe(true);
    await service.removeWorktree(repo, worktreePath);
    expect(fs.existsSync(worktreePath)).toBe(false);
  });
});

describe("mobile VCS routing", () => {
  it("serves git status through the mobile protocol", async () => {
    const repo = makeRepo();
    fs.writeFileSync(path.join(repo, "README.md"), "changed\n", "utf8");
    const model = new AppModel(repo);
    const router = new MobileRouter(model, new MobileDeviceStore(), new TerminalManager());
    await router.process({
      id: "pair",
      method: "pairDevice",
      params: { type: "pairDevice", value: { deviceID, deviceName: "Phone", token: "secret" } }
    }, clientID);
    const project = model.listProjects()[0];
    const response = await router.process({
      id: "status",
      method: "getVCSStatus",
      params: { type: "getVCSStatus", value: { projectID: project.id } }
    }, clientID);
    expect(response.result?.type).toBe("vcsStatus");
    if (response.result?.type !== "vcsStatus") throw new Error("Expected VCS status");
    expect(response.result.value.changedFiles.some((file) => file.path === "README.md")).toBe(true);
  });

  it("serves PR create and merge through the mobile protocol", async () => {
    const repo = makeRepo();
    const model = new AppModel(repo);
    const git = new RecordingGitService();
    const router = new MobileRouter(model, new MobileDeviceStore(), new TerminalManager(), undefined, git);
    await router.process({
      id: "pair",
      method: "pairDevice",
      params: { type: "pairDevice", value: { deviceID, deviceName: "Phone", token: "secret" } }
    }, clientID);
    const project = model.listProjects()[0];
    const create = await router.process({
      id: "create",
      method: "vcsCreatePR",
      params: { type: "vcsCreatePR", value: { projectID: project.id, title: "Windows migration", body: "Ready", baseBranch: "main", draft: true } }
    }, clientID);
    expect(create.result?.type).toBe("vcsPRCreated");
    if (create.result?.type !== "vcsPRCreated") throw new Error("Expected PR result");
    expect(create.result.value.number).toBe(42);
    const merge = await router.process({
      id: "merge",
      method: "vcsMergePullRequest",
      params: { type: "vcsMergePullRequest", value: { projectID: project.id, number: 42, method: "squash", deleteBranch: true } }
    }, clientID);
    expect(merge.result?.type).toBe("ok");
    expect(git.merged).toEqual({ number: 42, method: "squash", deleteBranch: true });
  });

  it("routes branch, diff, and mutation VCS methods through the mobile protocol", async () => {
    const repo = makeRepo();
    const model = new AppModel(repo);
    const git = new RecordingGitService();
    const router = new MobileRouter(model, new MobileDeviceStore(), new TerminalManager(), undefined, git);
    await router.process({
      id: "pair",
      method: "pairDevice",
      params: { type: "pairDevice", value: { deviceID, deviceName: "Phone", token: "secret" } }
    }, clientID);
    const project = model.listProjects()[0];

    const refresh = await router.process({
      id: "refresh",
      method: "vcsRefresh",
      params: { type: "vcsRefresh", value: { projectID: project.id } }
    }, clientID);
    expect(refresh.result?.type).toBe("vcsStatus");

    const branches = await router.process({
      id: "branches",
      method: "vcsListBranches",
      params: { type: "vcsListBranches", value: { projectID: project.id } }
    }, clientID);
    expect(branches.result?.type).toBe("vcsBranches");

    const commands = [
      {
        id: "stage",
        method: "vcsStageFiles" as const,
        params: { type: "vcsStageFiles" as const, value: { projectID: project.id, paths: ["README.md"] } }
      },
      {
        id: "unstage",
        method: "vcsUnstageFiles" as const,
        params: { type: "vcsUnstageFiles" as const, value: { projectID: project.id, paths: ["README.md"] } }
      },
      {
        id: "discard",
        method: "vcsDiscardFiles" as const,
        params: { type: "vcsDiscardFiles" as const, value: { projectID: project.id, paths: ["README.md"], untrackedPaths: ["notes.txt"] } }
      },
      {
        id: "commit",
        method: "vcsCommit" as const,
        params: { type: "vcsCommit" as const, value: { projectID: project.id, message: "Commit from mobile", stageAll: true } }
      },
      {
        id: "pull",
        method: "vcsPull" as const,
        params: { type: "vcsPull" as const, value: { projectID: project.id } }
      },
      {
        id: "push",
        method: "vcsPush" as const,
        params: { type: "vcsPush" as const, value: { projectID: project.id } }
      },
      {
        id: "switch",
        method: "vcsSwitchBranch" as const,
        params: { type: "vcsSwitchBranch" as const, value: { projectID: project.id, branch: "feature/mobile" } }
      },
      {
        id: "create-branch",
        method: "vcsCreateBranch" as const,
        params: { type: "vcsCreateBranch" as const, value: { projectID: project.id, name: "feature/windows" } }
      }
    ];

    for (const request of commands) {
      const response = await router.process(request, clientID);
      expect(response.result?.type).toBe("ok");
    }

    const diff = await router.process({
      id: "diff",
      method: "vcsGetDiff",
      params: { type: "vcsGetDiff", value: { projectID: project.id, filePath: "README.md", forceFull: false } }
    }, clientID);
    expect(diff.result?.type).toBe("vcsDiff");

    expect(git.calls).toEqual([
      "status",
      "branches",
      "stage:README.md",
      "unstage:README.md",
      "discard:README.md:notes.txt",
      "commit:Commit from mobile:true",
      "pull",
      "push",
      "switch:feature/mobile",
      "createBranch:feature/windows",
      "diff:README.md"
    ]);
  });

  it("adds and removes worktrees through the mobile protocol", async () => {
    const repo = makeRepo();
    const model = new AppModel(repo);
    const git = new RecordingGitService();
    const router = new MobileRouter(model, new MobileDeviceStore(), new TerminalManager(), undefined, git);
    await router.process({
      id: "pair",
      method: "pairDevice",
      params: { type: "pairDevice", value: { deviceID, deviceName: "Phone", token: "secret" } }
    }, clientID);
    const project = model.listProjects()[0];
    const add = await router.process({
      id: "add-wt",
      method: "vcsAddWorktree",
      params: { type: "vcsAddWorktree", value: { projectID: project.id, name: "feature-wt", branch: "feature/mobile", createBranch: true, baseBranch: "main" } }
    }, clientID);
    expect(add.result?.type).toBe("worktrees");
    if (add.result?.type !== "worktrees") throw new Error("Expected worktrees");
    expect(add.result.value).toHaveLength(2);
    const added = add.result.value.find((worktree) => worktree.canBeRemoved);
    expect(added?.branch).toBe("feature/mobile");
    expect(git.addedWorktree).toEqual({
      name: "feature-wt",
      branch: "feature/mobile",
      createBranch: true,
      baseBranch: "main"
    });

    const remove = await router.process({
      id: "remove-wt",
      method: "vcsRemoveWorktree",
      params: { type: "vcsRemoveWorktree", value: { projectID: project.id, worktreeID: added?.id ?? "" } }
    }, clientID);
    expect(remove.result?.type).toBe("ok");
    expect(model.listWorktrees(project.id)).toHaveLength(1);
    expect(git.removedWorktreePath).toBe(added?.path);
  });
});

class RecordingGitService extends GitService {
  merged?: { number: number; method: VCSMergeMethod; deleteBranch: boolean };
  addedWorktree?: { name: string; branch: string; createBranch: boolean; baseBranch?: string };
  removedWorktreePath?: string;
  readonly calls: string[] = [];

  override async status() {
    this.calls.push("status");
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

  override async branches() {
    this.calls.push("branches");
    return { current: "main", locals: ["main"], defaultBranch: "main" };
  }

  override async stage(_cwd: string, paths: string[]) {
    this.calls.push(`stage:${paths.join(",")}`);
  }

  override async unstage(_cwd: string, paths: string[]) {
    this.calls.push(`unstage:${paths.join(",")}`);
  }

  override async discard(_cwd: string, paths: string[], untrackedPaths: string[]) {
    this.calls.push(`discard:${paths.join(",")}:${untrackedPaths.join(",")}`);
  }

  override async commit(_cwd: string, message: string, stageAll: boolean) {
    this.calls.push(`commit:${message}:${stageAll}`);
  }

  override async pull() {
    this.calls.push("pull");
  }

  override async push() {
    this.calls.push("push");
  }

  override async switchBranch(_cwd: string, branch: string) {
    this.calls.push(`switch:${branch}`);
  }

  override async createBranch(_cwd: string, name: string) {
    this.calls.push(`createBranch:${name}`);
  }

  override async diff(_cwd: string, filePath: string) {
    this.calls.push(`diff:${filePath}`);
    return {
      filePath,
      rows: [{ kind: "context" as const, text: "README.md" }],
      additions: 0,
      deletions: 0,
      truncated: false,
      isBinary: false
    };
  }

  override async createPR() {
    return { url: "https://github.com/samuxy/samuxy/pull/42", number: 42 };
  }

  override async mergePR(_cwd: string, number: number, method: VCSMergeMethod, deleteBranch: boolean) {
    this.merged = { number, method, deleteBranch };
  }

  override async addWorktree(cwd: string, name: string, branch: string, createBranch: boolean, baseBranch: string | undefined) {
    this.addedWorktree = { name, branch, createBranch, baseBranch };
    return path.join(path.dirname(cwd), name);
  }

  override async removeWorktree(_cwd: string, worktreePath: string) {
    this.removedWorktreePath = worktreePath;
  }
}

function makeRepo(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "samuxy-vcs-"));
  tempRoots.push(root);
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  execFileSync("git", ["config", "core.autocrlf", "false"], { cwd: root });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: root });
  execFileSync("git", ["config", "user.name", "samuxy Test"], { cwd: root });
  fs.writeFileSync(path.join(root, "README.md"), "initial\n", "utf8");
  execFileSync("git", ["add", "README.md"], { cwd: root });
  execFileSync("git", ["commit", "-m", "initial"], { cwd: root, stdio: "ignore" });
  return root;
}
