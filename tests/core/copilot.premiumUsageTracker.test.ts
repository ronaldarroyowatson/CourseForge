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
    readFile.mockResolvedValue(JSON.stringify({
      premiumRequestsUsedToday: 8.6,
      premiumRequestsUsedThisWeek: 8.6,
      premiumRequestsUsedThisMonth: 8.6,
      dailyLimitPercent: baselineDailyLimit,
      weeklyLimitPercent: baselineWeeklyLimit,
      monthlyLimitPercent: 100,
      freezePremium: false,
      lastResetDate: "2026-03-13",
      lastResetWeek: "2026-W11",
      lastResetMonth: "2026-02-28@07:00"
    }));

    const tracker = await import("../../.copilot/usage/premiumUsageTracker.mjs");
    const result = await tracker.recordPremiumInvocation(1.4);

    expect(result.premiumRequestsUsedToday).toBe(10);
    expect(result.premiumRequestsUsedThisWeek).toBe(10);
    expect(result.premiumRequestsUsedThisMonth).toBe(10);
    expect(writeFile).toHaveBeenCalledTimes(1);
    expect(logPremiumInvocation).toHaveBeenCalledTimes(1);
  });

  it("denies escalation and audits when daily limit is exceeded", async () => {
    readFile.mockResolvedValue(JSON.stringify({
      premiumRequestsUsedToday: 8.6,
      premiumRequestsUsedThisWeek: 8.6,
      premiumRequestsUsedThisMonth: 8.6,
      dailyLimitPercent: baselineDailyLimit,
      weeklyLimitPercent: baselineWeeklyLimit,
      monthlyLimitPercent: 100,
      freezePremium: false,
      lastResetDate: "2026-03-13",
      lastResetWeek: "2026-W11",
      lastResetMonth: "2026-02-28@07:00"
    }));

    const tracker = await import("../../.copilot/usage/premiumUsageTracker.mjs");
    const result = await tracker.canEscalateToPremium({ freeFailuresForTask: 3, userApproved: true });

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("daily-limit");
    expect(logGateEvaluation).toHaveBeenCalledTimes(1);
    expect(logEscalationDecision).toHaveBeenCalledTimes(1);
  });

  it("toggles freeze state and writes an audit event", async () => {
    readFile.mockResolvedValue(JSON.stringify({
      premiumRequestsUsedToday: 8.6,
      premiumRequestsUsedThisWeek: 8.6,
      premiumRequestsUsedThisMonth: 8.6,
      dailyLimitPercent: baselineDailyLimit,
      weeklyLimitPercent: baselineWeeklyLimit,
      monthlyLimitPercent: 100,
      freezePremium: false,
      lastResetDate: "2026-03-13",
      lastResetWeek: "2026-W11",
      lastResetMonth: "2026-02-28@07:00"
    }));

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
