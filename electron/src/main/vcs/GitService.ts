import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import type { GitFileDTO, VCSBranchesDTO, VCSCreatePRResultDTO, VCSDiffDTO, VCSMergeMethod, VCSStatusDTO } from "../../shared/protocol.js";

const exec = promisify(execFile);

export interface GitClient {
  status(cwd: string): Promise<VCSStatusDTO>;
  branches(cwd: string): Promise<VCSBranchesDTO>;
  switchBranch(cwd: string, branch: string): Promise<void>;
  createBranch(cwd: string, name: string): Promise<void>;
  stage(cwd: string, paths: string[]): Promise<void>;
  unstage(cwd: string, paths: string[]): Promise<void>;
  discard(cwd: string, paths: string[], untrackedPaths: string[]): Promise<void>;
  commit(cwd: string, message: string, stageAll: boolean): Promise<void>;
  pull(cwd: string): Promise<void>;
  push(cwd: string): Promise<void>;
  diff(cwd: string, filePath: string): Promise<VCSDiffDTO>;
  createPR(cwd: string, title: string, body: string, baseBranch: string | undefined, draft: boolean): Promise<VCSCreatePRResultDTO>;
  mergePR(cwd: string, number: number, method: VCSMergeMethod, deleteBranch: boolean): Promise<void>;
  addWorktree(cwd: string, name: string, branch: string, createBranch: boolean, baseBranch: string | undefined): Promise<string>;
  removeWorktree(cwd: string, worktreePath: string): Promise<void>;
}

export class GitService implements GitClient {
  async status(cwd: string): Promise<VCSStatusDTO> {
    const branch = await this.currentBranch(cwd);
    const files = parseStatus((await this.git(cwd, ["status", "--short"])).stdout);
    return {
      branch,
      aheadCount: 0,
      behindCount: 0,
      hasUpstream: false,
      stagedFiles: files.filter((file) => file.staged),
      changedFiles: files.filter((file) => !file.staged),
      defaultBranch: await this.defaultBranch(cwd),
      pullRequest: undefined
    };
  }

  async branches(cwd: string): Promise<VCSBranchesDTO> {
    const current = await this.currentBranch(cwd);
    const output = (await this.git(cwd, ["branch", "--format=%(refname:short)"])).stdout;
    return {
      current,
      locals: output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean),
      defaultBranch: await this.defaultBranch(cwd)
    };
  }

  async switchBranch(cwd: string, branch: string): Promise<void> {
    await this.git(cwd, ["switch", branch]);
  }

  async createBranch(cwd: string, name: string): Promise<void> {
    await this.git(cwd, ["switch", "-c", name]);
  }

  async stage(cwd: string, paths: string[]): Promise<void> {
    await this.git(cwd, ["add", "--", ...paths]);
  }

  async unstage(cwd: string, paths: string[]): Promise<void> {
    await this.git(cwd, ["restore", "--staged", "--", ...paths]);
  }

  async discard(cwd: string, paths: string[], untrackedPaths: string[]): Promise<void> {
    if (paths.length > 0) await this.git(cwd, ["restore", "--", ...paths]);
    if (untrackedPaths.length > 0) await this.git(cwd, ["clean", "-f", "--", ...untrackedPaths]);
  }

  async commit(cwd: string, message: string, stageAll: boolean): Promise<void> {
    if (stageAll) await this.git(cwd, ["add", "--all"]);
    await this.git(cwd, ["commit", "-m", message]);
  }

  async pull(cwd: string): Promise<void> {
    await this.git(cwd, ["pull"]);
  }

  async push(cwd: string): Promise<void> {
    await this.git(cwd, ["push"]);
  }

  async diff(cwd: string, filePath: string): Promise<VCSDiffDTO> {
    const output = (await this.git(cwd, ["diff", "--", filePath])).stdout;
    const rows = output.split(/\r?\n/).map((text) => ({
      kind: text.startsWith("@@")
        ? "hunk" as const
        : text.startsWith("+")
          ? "addition" as const
          : text.startsWith("-")
            ? "deletion" as const
            : "context" as const,
      oldLineNumber: undefined,
      newLineNumber: undefined,
      oldText: undefined,
      newText: undefined,
      text
    }));
    return {
      filePath,
      rows,
      additions: rows.filter((row) => row.kind === "addition").length,
      deletions: rows.filter((row) => row.kind === "deletion").length,
      truncated: false,
      isBinary: false,
    };
  }

  async createPR(cwd: string, title: string, body: string, baseBranch: string | undefined, draft: boolean): Promise<VCSCreatePRResultDTO> {
    const args = ["pr", "create", "--title", title, "--body", body, "--json", "url,number"];
    if (baseBranch) args.push("--base", baseBranch);
    if (draft) args.push("--draft");
    const output = (await exec("gh", args, { cwd, windowsHide: true })).stdout;
    return JSON.parse(output) as VCSCreatePRResultDTO;
  }

  async mergePR(cwd: string, number: number, method: VCSMergeMethod, deleteBranch: boolean): Promise<void> {
    const args = ["pr", "merge", String(number), `--${method}`];
    if (deleteBranch) args.push("--delete-branch");
    await exec("gh", args, { cwd, windowsHide: true });
  }

  async addWorktree(cwd: string, name: string, branch: string, createBranch: boolean, baseBranch: string | undefined): Promise<string> {
    validateWorktreeName(name);
    validateBranchName(branch);
    if (baseBranch) validateBranchName(baseBranch);
    const worktreePath = path.resolve(path.dirname(cwd), name);
    const args = ["worktree", "add"];
    if (createBranch) {
      args.push("-b", branch, worktreePath);
      if (baseBranch) args.push(baseBranch);
    } else {
      args.push("--", worktreePath, branch);
    }
    await this.git(cwd, args);
    return worktreePath;
  }

  async removeWorktree(cwd: string, worktreePath: string): Promise<void> {
    await this.git(cwd, ["worktree", "remove", "--", worktreePath]);
  }

  private async currentBranch(cwd: string): Promise<string> {
    try {
      return (await this.git(cwd, ["branch", "--show-current"])).stdout.trim() || "HEAD";
    } catch {
      return "HEAD";
    }
  }

  private async defaultBranch(cwd: string): Promise<string | undefined> {
    try {
      const output = (await this.git(cwd, ["symbolic-ref", "refs/remotes/origin/HEAD", "--short"])).stdout.trim();
      return output.replace(/^origin\//, "") || undefined;
    } catch {
      return undefined;
    }
  }

  private async git(cwd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
    return exec("git", args, { cwd, windowsHide: true, maxBuffer: 10 * 1024 * 1024 });
  }
}

function validateWorktreeName(name: string): void {
  if (!name || name.includes("/") || name.includes("\\") || name === "." || name === "..") {
    throw new Error("Invalid worktree name.");
  }
}

function validateBranchName(branch: string): void {
  if (!branch || branch.startsWith("-") || !/^[A-Za-z0-9._/-]+$/.test(branch)) {
    throw new Error("Invalid branch name.");
  }
}

interface ParsedFile extends GitFileDTO {
  staged: boolean;
}

function parseStatus(output: string): ParsedFile[] {
  return output.split(/\r?\n/).flatMap<ParsedFile>((line) => {
    if (!line.trim()) return [];
    const index = line[0] ?? " ";
    const workingTree = line[1] ?? " ";
    const rawPath = line.slice(3).trim();
    const path = rawPath.includes(" -> ") ? rawPath.split(" -> ").at(-1) ?? rawPath : rawPath;
    if (!path) return [];
    if (index !== " " && index !== "?") return [{ path, status: statusFor(index), isUntracked: index === "?", staged: true }];
    return [{ path, status: statusFor(workingTree), isUntracked: workingTree === "?", staged: false }];
  });
}

function statusFor(code: string): GitFileDTO["status"] {
  switch (code) {
    case "A": return "added";
    case "D": return "deleted";
    case "R": return "renamed";
    case "C": return "copied";
    case "?": return "untracked";
    case "U": return "unmerged";
    default: return "modified";
  }
}
