import { describe, expect, it } from "vitest";
import { TerminalManager } from "../src/main/terminal/TerminalManager.js";

describe("TerminalManager snapshots", () => {
  it("returns buffered terminal content for desktop and mobile snapshots", () => {
    const manager = new TerminalManager();
    const internals = manager as unknown as { buffers: Map<string, string[]> };
    internals.buffers.set("pane-1", ["hello", "\n", "windows"]);
    expect(manager.snapshot("pane-1")).toEqual({ paneID: "pane-1", content: "hello\nwindows" });
    expect(manager.snapshot("missing")).toBeUndefined();
  });

  it("writes decoded text input to active terminal sessions", () => {
    const manager = new TerminalManager();
    const writes: string[] = [];
    const internals = manager as unknown as { sessions: Map<string, { write: (data: string) => void }> };
    internals.sessions.set("pane-1", { write: (data: string) => writes.push(data) });
    expect(manager.write("pane-1", Buffer.from("echo hi\n", "utf8").toString("base64"))).toBe(true);
    expect(manager.write("missing", "ZWNobyBoaQo=")).toBe(false);
    expect(writes).toEqual(["echo hi\n"]);
  });

  it("returns a scrolled terminal viewport for mobile content snapshots", () => {
    const manager = new TerminalManager();
    const internals = manager as unknown as {
      buffers: Map<string, string[]>;
      viewports: Map<string, { cols: number; rows: number }>;
    };
    internals.buffers.set("pane-1", ["one\ntwo\nthree\nfour\nfive"]);
    internals.viewports.set("pane-1", { cols: 80, rows: 2 });

    expect(manager.content("pane-1")?.join("")).toContain("five");
    expect(manager.scroll("pane-1", 2, true)).toBe(true);
    expect(manager.content("pane-1")).toEqual(["two\nthree"]);
    expect(manager.scroll("pane-1", -1, true)).toBe(true);
    expect(manager.content("pane-1")).toEqual(["three\nfour"]);
    expect(manager.scroll("missing", 1, true)).toBe(false);
  });
});
