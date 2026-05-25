import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export interface AIUsageMetricRow {
  label: string;
  percent?: number;
  resetDate?: string;
  detail?: string;
  periodDuration?: number;
}

export interface AIUsageSnapshot {
  providerID: string;
  providerName: string;
  fetchedAt: string;
  state: "available" | "unavailable" | "error";
  message?: string;
  rows: AIUsageMetricRow[];
}

export interface AIUsageProviderDefinition {
  id: "claude" | "codex" | "copilot" | "amp" | "kimi" | "minimax" | "factory" | "zai";
  name: string;
  fileName: string;
  parser: (payload: unknown) => AIUsageMetricRow[];
}

const providers: AIUsageProviderDefinition[] = [
  { id: "claude", name: "Claude Code", fileName: "claude-usage.json", parser: parseClaudeUsage },
  { id: "codex", name: "Codex", fileName: "codex-usage.json", parser: parseCodexUsage },
  { id: "copilot", name: "GitHub Copilot", fileName: "copilot-usage.json", parser: parseCopilotUsage },
  { id: "amp", name: "Amp", fileName: "amp-usage.json", parser: parseAmpUsage },
  { id: "kimi", name: "Kimi", fileName: "kimi-usage.json", parser: parseKimiUsage },
  { id: "minimax", name: "MiniMax", fileName: "minimax-usage.json", parser: parseGenericUsage },
  { id: "factory", name: "Factory", fileName: "factory-usage.json", parser: parseGenericUsage },
  { id: "zai", name: "Zai", fileName: "zai-usage.json", parser: parseGenericUsage }
];

export class AIUsageService {
  constructor(private readonly usageDirectory = defaultUsageDirectory()) {}

  async snapshots(): Promise<AIUsageSnapshot[]> {
    return Promise.all(providers.map((provider) => this.snapshot(provider)));
  }

  private async snapshot(provider: AIUsageProviderDefinition): Promise<AIUsageSnapshot> {
    try {
      const filePath = path.join(this.usageDirectory, provider.fileName);
      const payload = JSON.parse(await fs.readFile(filePath, "utf8")) as unknown;
      const rows = provider.parser(payload);
      if (rows.length === 0) {
        return this.unavailable(provider, "No usage rows found.");
      }
      return {
        providerID: provider.id,
        providerName: provider.name,
        fetchedAt: new Date().toISOString(),
        state: "available",
        rows
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return this.unavailable(provider, "Usage payload not found.");
      }
      return {
        providerID: provider.id,
        providerName: provider.name,
        fetchedAt: new Date().toISOString(),
        state: "error",
        message: (error as Error).message,
        rows: []
      };
    }
  }

  private unavailable(provider: AIUsageProviderDefinition, message: string): AIUsageSnapshot {
    return {
      providerID: provider.id,
      providerName: provider.name,
      fetchedAt: new Date().toISOString(),
      state: "unavailable",
      message,
      rows: []
    };
  }
}

export function parseClaudeUsage(payload: unknown): AIUsageMetricRow[] {
  if (!isRecord(payload)) throw new Error("Invalid Claude usage payload.");
  const windows = [
    { key: "five_hour", label: "5h", periodDuration: 5 * 60 * 60 },
    { key: "seven_day", label: "7d", periodDuration: 7 * 24 * 60 * 60 },
    { key: "seven_day_sonnet", label: "7d Sonnet", periodDuration: 7 * 24 * 60 * 60 },
    { key: "seven_day_omelette", label: "7d Omelette", periodDuration: 7 * 24 * 60 * 60 }
  ];
  const rows: AIUsageMetricRow[] = windows.flatMap((window) => {
    const value = payload[window.key];
    if (!isRecord(value)) return [];
    const percent = clampPercent(numberIn(value, ["utilization", "used_percent", "usedPercent"]));
    const resetDate = dateIn(value, ["resets_at", "reset_at", "resetAt", "window_end"]);
    if (percent === undefined && resetDate === undefined) return [];
    return [{
      label: window.label,
      percent,
      resetDate,
      detail: percent === undefined ? undefined : `${formatNumber(percent)}% used`,
      periodDuration: window.periodDuration
    }];
  });
  const extra = payload.extra_usage;
  if (isRecord(extra)) {
    const used = numberIn(extra, ["used_credits", "used"]);
    if (used !== undefined) {
      const limit = numberIn(extra, ["monthly_limit", "limit"]);
      rows.push({
        label: "Credits",
        detail: limit === undefined ? currencyDetail(used) : `${currencyDetail(used)}/${currencyDetail(limit)}`
      });
    }
  }
  return rows;
}

export function parseCodexUsage(payload: unknown): AIUsageMetricRow[] {
  if (!isRecord(payload)) throw new Error("Invalid Codex usage payload.");
  const rateLimit = payload.rate_limit;
  if (isRecord(rateLimit)) {
    const rows: AIUsageMetricRow[] = [];
    const primary = windowRow(rateLimit.primary_window, "5h");
    const secondary = windowRow(rateLimit.secondary_window, "7d");
    if (primary) rows.push(primary);
    if (secondary) rows.push(secondary);
    const reviews = isRecord(payload.code_review_rate_limit) ? windowRow(payload.code_review_rate_limit.primary_window, "Reviews") : undefined;
    if (reviews) rows.push(reviews);
    const credits = payload.credits;
    if (isRecord(credits) && credits.has_credits === true && credits.unlimited !== true) {
      const balance = numberIn(credits, ["balance"]);
      if (balance !== undefined) rows.push({ label: "Credits", detail: currencyDetail(balance) });
    }
    return rows;
  }
  return ["monthly", "daily", "hourly", "current_billing_period"].flatMap((key) => {
    const row = windowRow(payload[key], key === "current_billing_period" ? "Billing" : titleCase(key));
    return row ? [row] : [];
  });
}

export function parseCopilotUsage(payload: unknown): AIUsageMetricRow[] {
  if (!isRecord(payload)) throw new Error("Invalid Copilot usage payload.");
  const resetDate = dateIn(payload, ["quota_reset_date", "limited_user_reset_date"]);
  const monthlyPeriod = 30 * 24 * 60 * 60;
  const rows: AIUsageMetricRow[] = [];
  const snapshots = payload.quota_snapshots;
  const orderedKeys = ["premium_interactions", "chat"];

  if (isRecord(snapshots)) {
    const keys = [...orderedKeys, ...Object.keys(snapshots).filter((key) => !orderedKeys.includes(key))];
    for (const key of keys) {
      const snapshot = snapshots[key];
      if (!isRecord(snapshot)) continue;
      const remaining = numberIn(snapshot, ["remaining"]);
      const limit = numberIn(snapshot, ["entitlement", "quota", "limit"]);
      const percentRemaining = numberIn(snapshot, ["percent_remaining"]);
      const used = limit !== undefined && remaining !== undefined ? limit - remaining : undefined;
      rows.push({
        label: copilotLabel(key),
        percent: percentRemaining === undefined ? undefined : clampPercent(100 - percentRemaining),
        resetDate,
        detail: usageDetail(used, limit),
        periodDuration: monthlyPeriod
      });
    }
  }

  const monthlyQuotas = payload.monthly_quotas;
  const usedQuotas = payload.limited_user_quotas;
  if (isRecord(monthlyQuotas) && isRecord(usedQuotas)) {
    for (const [key, rawLimit] of Object.entries(monthlyQuotas)) {
      const limit = numberFromUnknown(rawLimit);
      if (limit === undefined) continue;
      const used = numberFromUnknown(usedQuotas[key]);
      rows.push({
        label: copilotLabel(key),
        percent: utilizationPercent(used, limit),
        resetDate,
        detail: usageDetail(used, limit),
        periodDuration: monthlyPeriod
      });
    }
  }

  return rows.filter((row) => row.percent !== undefined || row.resetDate !== undefined || row.detail !== undefined);
}

export function parseAmpUsage(payload: unknown): AIUsageMetricRow[] {
  if (!isRecord(payload)) throw new Error("Invalid Amp usage payload.");
  if (payload.ok === false) throw new Error("Invalid Amp usage payload.");
  const result = payload.result;
  const displayText = isRecord(result) ? stringIn(result, ["displayText", "display_text"]) : undefined;
  if (!displayText) throw new Error("Missing Amp display text.");
  const rows: AIUsageMetricRow[] = [];

  const balance = /\$([0-9]+(?:\.[0-9]+)?)\s*\/\s*\$([0-9]+(?:\.[0-9]+)?)\s*remaining/i.exec(displayText);
  if (balance) {
    const remaining = Number(balance[1]);
    const total = Number(balance[2]);
    const used = Math.max(0, total - remaining);
    rows.push({
      label: "Free balance",
      percent: utilizationPercent(used, total),
      resetDate: estimatedResetDate(used, parseAmpHourlyRate(displayText)),
      detail: usageDetail(used, total)
    });
  }

  const credits = /Individual credits:\s*\$([0-9]+(?:\.[0-9]+)?)\s*remaining/i.exec(displayText);
  if (credits) {
    rows.push({ label: "Credits", detail: currencyDetail(Number(credits[1])) });
  }
  return rows;
}

export function parseKimiUsage(payload: unknown): AIUsageMetricRow[] {
  if (!isRecord(payload)) throw new Error("Invalid Kimi usage payload.");
  const root = isRecord(payload.data) ? payload.data : payload;
  const limits = Array.isArray(root.limits) ? root.limits.filter(isRecord).map(parseKimiCandidate).filter((item) => item !== undefined) : [];
  const session = [...limits].sort((a, b) => (a.periodMs ?? Number.MAX_SAFE_INTEGER) - (b.periodMs ?? Number.MAX_SAFE_INTEGER))[0];
  const weekly = isRecord(root.usage) ? parseKimiQuota(root.usage) : undefined;
  const rows: AIUsageMetricRow[] = [];

  if (session) rows.push(kimiRow("Session", session.quota, session.periodMs));
  const fallbackWeekly = weekly ?? [...limits].filter((item) => item.periodMs !== session?.periodMs).sort((a, b) => (b.periodMs ?? 0) - (a.periodMs ?? 0))[0]?.quota;
  if (fallbackWeekly && fallbackWeekly !== session?.quota) rows.push(kimiRow("Weekly", fallbackWeekly));
  return rows.filter((row) => row.percent !== undefined || row.resetDate !== undefined);
}

export function parseGenericUsage(payload: unknown): AIUsageMetricRow[] {
  if (!isRecord(payload)) throw new Error("Invalid AI usage payload.");
  const candidates = [payload, payload.data, payload.result].filter(isRecord);
  return candidates.flatMap((candidate) => {
    const rows = ["session", "five_hour", "daily", "weekly", "monthly", "requests", "credits", "current_billing_period"].flatMap((key) => {
      const row = windowRow(candidate[key], key === "five_hour" ? "5h" : key === "current_billing_period" ? "Billing" : titleCase(key));
      return row ? [row] : [];
    });
    if (rows.length > 0) return rows;
    return parseRemainRows(candidate);
  }).slice(0, 8);
}

function windowRow(value: unknown, fallbackLabel: string): AIUsageMetricRow | undefined {
  if (!isRecord(value)) return undefined;
  const percent = clampPercent(numberIn(value, ["used_percent", "utilization", "usedPercent", "percent"]));
  const resetDate = dateIn(value, ["reset_at", "resets_at", "resetAt", "window_end"]);
  if (percent === undefined && resetDate === undefined) return undefined;
  const duration = numberIn(value, ["limit_window_seconds", "periodDuration"]);
  return {
    label: duration === 18000 ? "5h" : duration === 604800 && fallbackLabel !== "Reviews" ? "7d" : fallbackLabel,
    percent,
    resetDate,
    detail: percent === undefined ? undefined : `${formatNumber(percent)}% used`,
    periodDuration: duration
  };
}

function parseRemainRows(payload: Record<string, unknown>): AIUsageMetricRow[] {
  const remains = Array.isArray(payload.model_remains) ? payload.model_remains : Array.isArray(payload.modelRemains) ? payload.modelRemains : [];
  return remains.filter(isRecord).flatMap((row, index) => {
    const limit = numberIn(row, ["current_interval_total_count", "currentIntervalTotalCount", "total", "limit"]);
    if (limit === undefined || limit <= 0) return [];
    const remaining = numberIn(row, ["current_interval_remaining_count", "currentIntervalRemainingCount", "remaining", "remains"]);
    const explicitUsed = numberIn(row, ["used_count", "current_interval_used_count", "currentIntervalUsedCount", "used"]);
    const used = explicitUsed ?? (remaining === undefined ? undefined : limit - remaining);
    const resetDate = dateIn(row, ["end_time", "endTime", "reset_at", "resetAt"]);
    return [{
      label: index === 0 ? "Session" : `Session ${index + 1}`,
      percent: utilizationPercent(used, limit),
      resetDate,
      detail: usageDetail(used, limit),
      periodDuration: 5 * 60 * 60
    }];
  });
}

function parseKimiCandidate(item: Record<string, unknown>): { quota: KimiQuota; periodMs?: number } | undefined {
  const detail = isRecord(item.detail) ? item.detail : item;
  const quota = parseKimiQuota(detail);
  if (!quota) return undefined;
  return { quota, periodMs: parseKimiWindowPeriodMs(isRecord(item.window) ? item.window : undefined) };
}

interface KimiQuota {
  used: number;
  limit: number;
  resetDate?: string;
}

function parseKimiQuota(detail: Record<string, unknown>): KimiQuota | undefined {
  const limit = numberIn(detail, ["limit", "max", "total"]);
  if (limit === undefined || limit <= 0) return undefined;
  const directUsed = numberIn(detail, ["used", "current"]);
  const remaining = numberIn(detail, ["remaining", "remains", "left"]);
  const used = directUsed ?? (remaining === undefined ? undefined : Math.max(0, limit - remaining));
  if (used === undefined) return undefined;
  return {
    used: Math.min(used, limit),
    limit,
    resetDate: dateIn(detail, ["resetTime", "reset_at", "resetAt", "reset_time"])
  };
}

function kimiRow(label: string, quota: KimiQuota, periodMs?: number): AIUsageMetricRow {
  const percent = utilizationPercent(quota.used, quota.limit);
  return {
    label,
    percent,
    resetDate: quota.resetDate,
    detail: percent === undefined ? undefined : `${formatNumber(percent)}% used`,
    periodDuration: periodMs === undefined ? undefined : periodMs / 1000
  };
}

function parseKimiWindowPeriodMs(window: Record<string, unknown> | undefined): number | undefined {
  if (!window) return undefined;
  const duration = numberIn(window, ["duration"]);
  if (duration === undefined || duration <= 0) return undefined;
  const unit = (stringIn(window, ["timeUnit", "time_unit"]) ?? "").toUpperCase();
  if (unit.includes("MINUTE")) return duration * 60_000;
  if (unit.includes("HOUR")) return duration * 3_600_000;
  if (unit.includes("DAY")) return duration * 86_400_000;
  if (unit.includes("SECOND")) return duration * 1000;
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringIn(value: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const raw = value[key];
    if (typeof raw === "string" && raw.trim()) return raw;
  }
  return undefined;
}

function numberIn(value: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const raw = value[key];
    if (typeof raw === "number" && Number.isFinite(raw)) return raw;
    if (typeof raw === "string" && raw.trim() && Number.isFinite(Number(raw))) return Number(raw);
  }
  return undefined;
}

function dateIn(value: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const raw = value[key];
    if (typeof raw === "string" && raw.trim()) return new Date(raw).toISOString();
    if (typeof raw === "number" && Number.isFinite(raw)) return new Date(raw * 1000).toISOString();
  }
  return undefined;
}

function clampPercent(value: number | undefined): number | undefined {
  return value === undefined ? undefined : Math.max(0, Math.min(100, value));
}

function utilizationPercent(used: number | undefined, limit: number | undefined): number | undefined {
  if (used === undefined || limit === undefined || limit <= 0) return undefined;
  return clampPercent((used / limit) * 100);
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function currencyDetail(amount: number): string {
  return `$${formatNumber(amount)}`;
}

function usageDetail(used: number | undefined, limit: number | undefined): string | undefined {
  if (used === undefined || limit === undefined) return undefined;
  return `${formatNumber(Math.max(0, used))}/${formatNumber(limit)}`;
}

function numberFromUnknown(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return undefined;
}

function estimatedResetDate(used: number, hourlyRate: number | undefined): string | undefined {
  if (used <= 0 || hourlyRate === undefined || hourlyRate <= 0) return undefined;
  return new Date(Date.now() + (used / hourlyRate) * 60 * 60 * 1000).toISOString();
}

function parseAmpHourlyRate(text: string): number | undefined {
  const match = /\+\$([0-9]+(?:\.[0-9]+)?)\s*\/\s*hour/i.exec(text);
  return match ? Number(match[1]) : undefined;
}

function copilotLabel(value: string): string {
  if (value.toLowerCase() === "premium_interactions") return "Premium";
  if (value.toLowerCase() === "chat") return "Chat";
  if (value.toLowerCase() === "completions") return "Completions";
  return titleCase(value);
}

function titleCase(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function defaultUsageDirectory(): string {
  return path.join(process.env.SAMUXY_AI_USAGE_DIR ?? path.join(os.homedir(), ".samuxy", "usage"));
}
