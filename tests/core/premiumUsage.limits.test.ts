import { describe, expect, it } from "vitest";
import {
  MONTHLY_BASELINE_PERCENT,
  applyPremiumResets,
  attemptPremiumEscalation,
  createDefaultPremiumUsage,
  evaluatePremiumGate,
  getDefaultDailyLimitPercent,
  getDefaultWeeklyLimitPercent,
  getIsoWeekKey,
  getMonthlyResetKey,
  recordPremiumRequest,
  type PremiumUsageState,
} from "../../src/core/services/premiumUsageService";

function withUsage(overrides: Partial<PremiumUsageState>): PremiumUsageState {
  return {
    ...createDefaultPremiumUsage(new Date("2026-03-13T10:00:00Z")),
    ...overrides,
  };
}

describe("premium usage limits", () => {
  it("derives default daily and weekly caps from the 8.6% baseline", () => {
    const usage = createDefaultPremiumUsage(new Date(2026, 2, 13, 10, 0, 0));

    expect(MONTHLY_BASELINE_PERCENT).toBe(8.6);
    expect(usage.dailyLimitPercent).toBe(getDefaultDailyLimitPercent());
    expect(usage.weeklyLimitPercent).toBe(getDefaultWeeklyLimitPercent());
    expect(usage.monthlyLimitPercent).toBe(100);
  });

  it("allows premium usage when below all limits", () => {
    const decision = evaluatePremiumGate(
      withUsage({
        premiumRequestsUsedToday: 1,
        premiumRequestsUsedThisWeek: 10,
        premiumRequestsUsedThisMonth: 50,
      }),
      new Date("2026-03-13T10:00:00Z")
    );

    expect(decision.allowPremium).toBe(true);
    expect(decision.reason).toBe("within-limits");
  });

  it("blocks premium when daily limit is exceeded", () => {
    const decision = evaluatePremiumGate(
      withUsage({
        premiumRequestsUsedToday: 4,
      }),
      new Date("2026-03-13T10:00:00Z")
    );

    expect(decision.allowPremium).toBe(false);
    expect(decision.reason).toBe("daily-limit");
    expect(decision.requiresUserApproval).toBe(true);
  });

  it("blocks premium when weekly limit is exceeded", () => {
    const decision = evaluatePremiumGate(
      withUsage({
        premiumRequestsUsedThisWeek: 24,
      }),
      new Date("2026-03-13T10:00:00Z")
    );

    expect(decision.allowPremium).toBe(false);
    expect(decision.reason).toBe("weekly-limit");
    expect(decision.requiresUserApproval).toBe(true);
  });

  it("hard-freezes premium when monthly limit is exceeded", () => {
    const decision = evaluatePremiumGate(
      withUsage({
        premiumRequestsUsedThisMonth: 101,
      }),
      new Date("2026-03-13T10:00:00Z")
    );

    expect(decision.allowPremium).toBe(false);
    expect(decision.reason).toBe("monthly-hard-freeze");
    expect(decision.nextState.freezePremium).toBe(true);
  });

  it("always blocks premium when freezePremium is true", () => {
    const decision = evaluatePremiumGate(
      withUsage({
        freezePremium: true,
        premiumRequestsUsedToday: 0,
      }),
      new Date("2026-03-13T10:00:00Z")
    );

    expect(decision.allowPremium).toBe(false);
    expect(decision.reason).toBe("frozen");
  });

  it("resets daily, weekly, and monthly counters across boundaries", () => {
    const base = withUsage({
      premiumRequestsUsedToday: 2,
      premiumRequestsUsedThisWeek: 12,
      premiumRequestsUsedThisMonth: 55,
      lastResetDate: "2026-03-12",
      lastResetWeek: "2026-W10",
      lastResetMonth: "2026-02-28@07:00",
    });

    const now = new Date(2026, 3, 1, 7, 1, 0);
    const { usage, resetApplied } = applyPremiumResets(base, now);

    expect(resetApplied).toBe(true);
    expect(usage.premiumRequestsUsedToday).toBe(0);
    expect(usage.premiumRequestsUsedThisWeek).toBe(0);
    expect(usage.premiumRequestsUsedThisMonth).toBe(0);
    expect(usage.lastResetDate).toBe("2026-04-01");
    expect(usage.lastResetWeek).toBe(getIsoWeekKey(now));
    expect(usage.lastResetMonth).toBe("2026-03-31@07:00");
  });

  it("does not reset monthly counter before the local 31st 07:00 threshold", () => {
    const now = new Date(2026, 2, 31, 6, 59, 0);
    const currentMonthResetKey = getMonthlyResetKey(now);
    const usage = withUsage({
      premiumRequestsUsedToday: 6,
      premiumRequestsUsedThisWeek: 22,
      premiumRequestsUsedThisMonth: 44,
      lastResetDate: "2026-03-31",
      lastResetWeek: getIsoWeekKey(now),
      lastResetMonth: currentMonthResetKey,
    });

    const { usage: result, resetApplied } = applyPremiumResets(usage, now);
    expect(resetApplied).toBe(false);
    expect(result.premiumRequestsUsedThisMonth).toBe(44);
    expect(result.lastResetMonth).toBe(currentMonthResetKey);
  });

  it("resets monthly counter at month-end fallback 07:00 when month has no day 31", () => {
    const beforeReset = new Date(2026, 1, 28, 6, 59, 0);
    const afterReset = new Date(2026, 1, 28, 7, 0, 1);
    const usage = withUsage({
      premiumRequestsUsedThisMonth: 40,
      lastResetMonth: getMonthlyResetKey(beforeReset),
    });

    const { usage: result, resetApplied } = applyPremiumResets(usage, afterReset);

    expect(resetApplied).toBe(true);
    expect(result.premiumRequestsUsedThisMonth).toBe(0);
    expect(result.lastResetMonth).toBe("2026-02-28@07:00");
  });

  it("allows premium escalation only after 3 free failures and user approval", () => {
    const notEnoughFailures = attemptPremiumEscalation({
      usage: withUsage({}),
      freeFailuresForTask: 2,
      userApproved: true,
    });
    expect(notEnoughFailures.premiumWasUsed).toBe(false);
    expect(notEnoughFailures.reason).toBe("free-failure-threshold-not-met");

    const deniedWithoutApproval = attemptPremiumEscalation({
      usage: withUsage({}),
      freeFailuresForTask: 3,
      userApproved: false,
    });
    expect(deniedWithoutApproval.premiumWasUsed).toBe(false);
    expect(deniedWithoutApproval.reason).toBe("user-denied");

    const approved = attemptPremiumEscalation({
      usage: withUsage({}),
      freeFailuresForTask: 3,
      userApproved: true,
    });
    expect(approved.premiumWasUsed).toBe(true);
    expect(approved.escalationApproved).toBe(true);
    expect(approved.usage.premiumRequestsUsedToday).toBe(1);
  });

  it("increments counters when a premium request is recorded", () => {
    const usage = recordPremiumRequest(
      withUsage({
        premiumRequestsUsedToday: 1,
        premiumRequestsUsedThisWeek: 2,
        premiumRequestsUsedThisMonth: 3,
      }),
      2
    );

    expect(usage.premiumRequestsUsedToday).toBe(3);
    expect(usage.premiumRequestsUsedThisWeek).toBe(4);
    expect(usage.premiumRequestsUsedThisMonth).toBe(5);
  });
});
