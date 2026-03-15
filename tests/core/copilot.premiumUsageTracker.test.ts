import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const readFile = vi.fn(async (_filePath: string, _encoding: string) => "");
const writeFile = vi.fn(async (_filePath: string, _content: string, _encoding: string) => undefined);
const mkdir = vi.fn(async (_dirPath: string, _options: { recursive: boolean }) => undefined);
const logEscalationDecision = vi.fn(async () => undefined);
const logFreezeChange = vi.fn(async () => undefined);
const logGateEvaluation = vi.fn(async () => undefined);
const logPremiumInvocation = vi.fn(async () => undefined);

vi.mock("node:fs/promises", () => ({
  default: {
    readFile,
    writeFile,
    mkdir,
  },
}));

vi.mock("../../.copilot/usage/auditLogger.mjs", () => ({
  logEscalationDecision,
  logFreezeChange,
  logGateEvaluation,
  logPremiumInvocation,
}));

const baselineDailyLimit = Number((8.6 * 0.4).toFixed(1));
const baselineWeeklyLimit = Number((8.6 * 2.7).toFixed(1));

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function getLocalDateKey(now = new Date()): string {
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

function getIsoWeekKey(now = new Date()): string {
  const dayMs = 24 * 60 * 60 * 1000;
  const utcDate = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const day = utcDate.getUTCDay() || 7;
  utcDate.setUTCDate(utcDate.getUTCDate() + 4 - day);

  const isoYear = utcDate.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const week = Math.ceil((((utcDate.getTime() - yearStart.getTime()) / dayMs) + 1) / 7);
  return `${isoYear}-W${pad2(week)}`;
}

function getMonthlyResetKey(now = new Date()): string {
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const resetDay = Math.min(31, daysInMonth);
  const currentAnchor = new Date(now.getFullYear(), now.getMonth(), resetDay, 7, 0, 0, 0);

  if (now.getTime() >= currentAnchor.getTime()) {
    return `${currentAnchor.getFullYear()}-${pad2(currentAnchor.getMonth() + 1)}-${pad2(currentAnchor.getDate())}@07:00`;
  }

  const previousMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const previousDaysInMonth = new Date(previousMonth.getFullYear(), previousMonth.getMonth() + 1, 0).getDate();
  const previousResetDay = Math.min(31, previousDaysInMonth);
  return `${previousMonth.getFullYear()}-${pad2(previousMonth.getMonth() + 1)}-${pad2(previousResetDay)}@07:00`;
}

function createCurrentUsageSnapshot(): Record<string, unknown> {
  const now = new Date();
  return {
    premiumRequestsUsedToday: 8.6,
    premiumRequestsUsedThisWeek: 8.6,
    premiumRequestsUsedThisMonth: 8.6,
    dailyLimitPercent: baselineDailyLimit,
    weeklyLimitPercent: baselineWeeklyLimit,
    monthlyLimitPercent: 100,
    freezePremium: false,
    lastResetDate: getLocalDateKey(now),
    lastResetWeek: getIsoWeekKey(now),
    lastResetMonth: getMonthlyResetKey(now),
  };
}

describe("copilot premium usage tracker", () => {
  beforeEach(() => {
    vi.resetModules();
    readFile.mockReset();
    writeFile.mockReset();
    mkdir.mockReset();
    logEscalationDecision.mockReset();
    logFreezeChange.mockReset();
    logGateEvaluation.mockReset();
    logPremiumInvocation.mockReset();
    writeFile.mockResolvedValue(undefined);
    mkdir.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("normalizes usage and writes incremented premium invocation state", async () => {
    readFile.mockResolvedValue(JSON.stringify(createCurrentUsageSnapshot()));

    const tracker = await import("../../.copilot/usage/premiumUsageTracker.mjs");
    const result = await tracker.recordPremiumInvocation(1.4);

    expect(result.premiumRequestsUsedToday).toBe(10);
    expect(result.premiumRequestsUsedThisWeek).toBe(10);
    expect(result.premiumRequestsUsedThisMonth).toBe(10);
    expect(writeFile).toHaveBeenCalledTimes(1);
    expect(logPremiumInvocation).toHaveBeenCalledTimes(1);
  });

  it("denies escalation and audits when daily limit is exceeded", async () => {
    readFile.mockResolvedValue(JSON.stringify(createCurrentUsageSnapshot()));

    const tracker = await import("../../.copilot/usage/premiumUsageTracker.mjs");
    const result = await tracker.canEscalateToPremium({ freeFailuresForTask: 3, userApproved: true });

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("daily-limit");
    expect(logGateEvaluation).toHaveBeenCalledTimes(1);
    expect(logEscalationDecision).toHaveBeenCalledTimes(1);
  });

  it("toggles freeze state and writes an audit event", async () => {
    readFile.mockResolvedValue(JSON.stringify(createCurrentUsageSnapshot()));

    const tracker = await import("../../.copilot/usage/premiumUsageTracker.mjs");
    const result = await tracker.setPremiumFreeze(true);

    expect(result.freezePremium).toBe(true);
    expect(writeFile).toHaveBeenCalledTimes(1);
    expect(logFreezeChange).toHaveBeenCalledTimes(1);
  });

  it("creates baseline-derived defaults when usage file does not exist", async () => {
    readFile.mockRejectedValue(new Error("missing"));

    const tracker = await import("../../.copilot/usage/premiumUsageTracker.mjs");
    const usage = await tracker.readPremiumUsage(new Date(2026, 2, 31, 7, 1, 0));

    expect(usage.dailyLimitPercent).toBe(baselineDailyLimit);
    expect(usage.weeklyLimitPercent).toBe(baselineWeeklyLimit);
    expect(usage.monthlyLimitPercent).toBe(100);
    expect(usage.lastResetMonth).toBe("2026-03-31@07:00");
    expect(writeFile).toHaveBeenCalledTimes(1);
  });

  it("resets monthly usage at local month-end fallback 07:00", async () => {
    readFile.mockResolvedValue(JSON.stringify({
      premiumRequestsUsedToday: 4,
      premiumRequestsUsedThisWeek: 12,
      premiumRequestsUsedThisMonth: 33,
      dailyLimitPercent: baselineDailyLimit,
      weeklyLimitPercent: baselineWeeklyLimit,
      monthlyLimitPercent: 100,
      freezePremium: false,
      lastResetDate: "2026-02-27",
      lastResetWeek: "2026-W08",
      lastResetMonth: "2026-01-31@07:00"
    }));

    const tracker = await import("../../.copilot/usage/premiumUsageTracker.mjs");
    const usage = await tracker.readPremiumUsage(new Date(2026, 1, 28, 7, 0, 1));

    expect(usage.premiumRequestsUsedThisMonth).toBe(0);
    expect(usage.lastResetMonth).toBe("2026-02-28@07:00");
  });
});
