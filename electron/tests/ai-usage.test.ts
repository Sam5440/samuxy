import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AIUsageService, parseAmpUsage, parseClaudeUsage, parseCodexUsage, parseCopilotUsage, parseKimiUsage } from "../src/main/ai/AIUsageService.js";
import { MobileDeviceStore } from "../src/main/mobile/MobileDeviceStore.js";
import { MobileRouter } from "../src/main/mobile/MobileRouter.js";
import { AppModel } from "../src/main/state/AppModel.js";
import { TerminalManager } from "../src/main/terminal/TerminalManager.js";

const tempRoots: string[] = [];
const clientID = "a4be60dd-5e58-4e75-b1b7-bc7d610ce641";
const deviceID = "93e61056-4ef5-4ca9-92ff-3e7b30af2ded";

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("AI usage parsers", () => {
  it("parses Claude usage windows and credits", () => {
    const rows = parseClaudeUsage({
      five_hour: { utilization: 25, resets_at: "2026-05-23T12:00:00Z" },
      seven_day: { used_percent: 80 },
      extra_usage: { used_credits: 3, monthly_limit: 20 }
    });
    expect(rows.map((row) => row.label)).toEqual(["5h", "7d", "Credits"]);
    expect(rows[0].detail).toBe("25% used");
    expect(rows[2].detail).toBe("$3/$20");
  });

  it("parses Codex wham rate limit windows and credits", () => {
    const rows = parseCodexUsage({
      rate_limit: {
        primary_window: { used_percent: 40, limit_window_seconds: 18000 },
        secondary_window: { used_percent: 70, limit_window_seconds: 604800 }
      },
      code_review_rate_limit: {
        primary_window: { used_percent: 10 }
      },
      credits: { has_credits: true, unlimited: false, balance: 15 }
    });
    expect(rows.map((row) => row.label)).toEqual(["5h", "7d", "Reviews", "Credits"]);
  });

  it("parses GitHub Copilot paid and free quota payloads", () => {
    const paid = parseCopilotUsage({
      quota_reset_date: "2025-02-15T00:00:00Z",
      quota_snapshots: {
        premium_interactions: { percent_remaining: 80, entitlement: 300, remaining: 240 },
        chat: { percent_remaining: 95, entitlement: 1000, remaining: 950 }
      }
    });
    expect(paid.map((row) => row.label)).toEqual(["Premium", "Chat"]);
    expect(paid[0].percent).toBe(20);
    expect(paid[0].detail).toBe("60/300");

    const free = parseCopilotUsage({
      limited_user_quotas: { chat: 410, completions: 4000 },
      monthly_quotas: { chat: 500, completions: 4000 },
      limited_user_reset_date: "2025-02-11"
    });
    expect(Object.fromEntries(free.map((row) => [row.label, row.percent]))).toMatchObject({ Chat: 82, Completions: 100 });
  });

  it("parses Amp display text balances and credits", () => {
    const rows = parseAmpUsage({
      ok: true,
      result: {
        displayText: "Amp Free: $48/$50 remaining, replenishes +$2/hour. Individual credits: $7.5 remaining"
      }
    });
    expect(rows.map((row) => row.label)).toEqual(["Free balance", "Credits"]);
    expect(rows[0].percent).toBe(4);
    expect(rows[0].detail).toBe("2/50");
    expect(rows[1].detail).toBe("$7.5");
  });

  it("parses Kimi session and weekly quotas", () => {
    const rows = parseKimiUsage({
      data: {
        limits: [
          { detail: { limit: 100, remaining: 75 }, window: { duration: 5, timeUnit: "HOUR" } },
          { detail: { limit: 500, used: 250 }, window: { duration: 7, timeUnit: "DAY" } }
        ]
      }
    });
    expect(rows.map((row) => row.label)).toEqual(["Session", "Weekly"]);
    expect(rows[0].percent).toBe(25);
    expect(rows[1].percent).toBe(50);
  });
});

describe("AIUsageService", () => {
  it("loads provider snapshots from Windows-readable JSON files", async () => {
    const root = makeTempRoot();
    fs.writeFileSync(path.join(root, "claude-usage.json"), JSON.stringify({ five_hour: { utilization: 30 } }), "utf8");
    fs.writeFileSync(path.join(root, "codex-usage.json"), JSON.stringify({ monthly: { used_percent: 55 } }), "utf8");
    fs.writeFileSync(path.join(root, "amp-usage.json"), JSON.stringify({ ok: true, result: { displayText: "Amp Free: $8/$10 remaining" } }), "utf8");
    const snapshots = await new AIUsageService(root).snapshots();
    expect(snapshots.filter((snapshot) => snapshot.state === "available")).toHaveLength(3);
    expect(snapshots.find((snapshot) => snapshot.providerID === "codex")?.rows[0].label).toBe("Monthly");
    expect(snapshots.find((snapshot) => snapshot.providerID === "copilot")?.state).toBe("unavailable");
  });

  it("serves AI usage snapshots through authenticated mobile routes", async () => {
    const root = makeTempRoot();
    fs.writeFileSync(path.join(root, "claude-usage.json"), JSON.stringify({ five_hour: { utilization: 20 } }), "utf8");
    const router = new MobileRouter(
      new AppModel(process.cwd()),
      new MobileDeviceStore(),
      new TerminalManager(),
      undefined,
      undefined,
      new AIUsageService(root)
    );
    await router.process({
      id: "pair",
      method: "pairDevice",
      params: { type: "pairDevice", value: { deviceID, deviceName: "Phone", token: "secret" } }
    }, clientID);
    const response = await router.process({ id: "usage", method: "listAIUsage" }, clientID);
    expect(response.result?.type).toBe("aiUsage");
    if (response.result?.type !== "aiUsage") throw new Error("Expected AI usage result");
    expect(response.result.value.some((snapshot) => snapshot.providerID === "claude" && snapshot.state === "available")).toBe(true);
  });
});

function makeTempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "samuxy-ai-usage-"));
  tempRoots.push(root);
  return root;
}
