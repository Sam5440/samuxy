import { EventEmitter } from "node:events";
import pty from "node-pty";
import { defaultShell } from "../platform.js";

export interface TerminalSession {
  paneID: string;
  title: string;
  cwd: string;
  cols: number;
  rows: number;
}

export interface TerminalOutput {
  paneID: string;
  data: string;
}

export interface TerminalSnapshot {
  paneID: string;
  content: string;
}

export class TerminalManager extends EventEmitter {
  private readonly sessions = new Map<string, pty.IPty>();
  private readonly buffers = new Map<string, string[]>();
  private readonly viewports = new Map<string, { cols: number; rows: number }>();
  private readonly scrollOffsets = new Map<string, number>();

  create(session: TerminalSession): void {
    if (this.sessions.has(session.paneID)) return;
    const shell = defaultShell();
    const child = pty.spawn(shell, [], {
      name: "xterm-256color",
      cols: session.cols,
      rows: session.rows,
      cwd: session.cwd,
      env: process.env
    });
    child.onData((data) => {
      const lines = this.buffers.get(session.paneID) ?? [];
      lines.push(data);
      if (lines.length > 2000) lines.splice(0, lines.length - 2000);
      this.buffers.set(session.paneID, lines);
      this.scrollOffsets.set(session.paneID, 0);
      this.emit("output", { paneID: session.paneID, data } satisfies TerminalOutput);
    });
    child.onExit(() => {
      this.sessions.delete(session.paneID);
      this.emit("closed", session.paneID);
    });
    this.sessions.set(session.paneID, child);
    this.buffers.set(session.paneID, []);
    this.viewports.set(session.paneID, { cols: session.cols, rows: session.rows });
    this.scrollOffsets.set(session.paneID, 0);
  }

  write(paneID: string, bytes: string): boolean {
    const session = this.sessions.get(paneID);
    if (!session) return false;
    session.write(Buffer.from(bytes, "base64").toString("utf8"));
    return true;
  }

  has(paneID: string): boolean {
    return this.sessions.has(paneID);
  }

  resize(paneID: string, cols: number, rows: number): boolean {
    const session = this.sessions.get(paneID);
    if (!session) return false;
    session.resize(cols, rows);
    this.viewports.set(paneID, { cols, rows });
    this.scrollOffsets.set(paneID, Math.min(this.scrollOffsets.get(paneID) ?? 0, this.maxScrollOffset(paneID)));
    return true;
  }

  content(paneID: string): string[] | undefined {
    const chunks = this.buffers.get(paneID);
    if (!chunks) return undefined;
    const rows = this.viewports.get(paneID)?.rows ?? 24;
    const offset = this.scrollOffsets.get(paneID) ?? 0;
    if (offset <= 0) return chunks;
    const lines = this.linesFor(paneID);
    const end = Math.max(0, lines.length - offset);
    const start = Math.max(0, end - rows);
    return [lines.slice(start, end).join("\n")];
  }

  scroll(paneID: string, deltaY: number, precise: boolean): boolean {
    if (!this.buffers.has(paneID)) return false;
    const delta = precise ? Math.round(deltaY) : Math.sign(deltaY);
    const nextOffset = Math.max(0, Math.min(this.maxScrollOffset(paneID), (this.scrollOffsets.get(paneID) ?? 0) + delta));
    this.scrollOffsets.set(paneID, nextOffset);
    this.emit("scroll", { paneID, offset: nextOffset });
    return true;
  }

  snapshot(paneID: string): TerminalSnapshot | undefined {
    const chunks = this.buffers.get(paneID);
    if (!chunks) return undefined;
    return { paneID, content: chunks.join("") };
  }

  close(paneID: string): void {
    this.sessions.get(paneID)?.kill();
    this.sessions.delete(paneID);
    this.buffers.delete(paneID);
    this.viewports.delete(paneID);
    this.scrollOffsets.delete(paneID);
  }

  private maxScrollOffset(paneID: string): number {
    const rows = this.viewports.get(paneID)?.rows ?? 24;
    return Math.max(0, this.linesFor(paneID).length - rows);
  }

  private linesFor(paneID: string): string[] {
    return (this.buffers.get(paneID) ?? []).join("").replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  }
}
