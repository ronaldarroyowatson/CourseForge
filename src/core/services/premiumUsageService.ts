export interface PremiumUsageState {
  premiumRequestsUsedToday: number;
  premiumRequestsUsedThisWeek: number;
  premiumRequestsUsedThisMonth: number;
  dailyLimitPercent: number;
  weeklyLimitPercent: number;
  monthlyLimitPercent: number;
  freezePremium: boolean;
  lastResetDate: string;
  lastResetWeek: string;
  lastResetMonth: string;
}

export interface PremiumGateDecision {
  allowPremium: boolean;
  requiresUserApproval: boolean;
  deniedDueToLimits: boolean;
  reason:
    | "within-limits"
    | "frozen"
    | "daily-limit"
    | "weekly-limit"
    | "monthly-hard-freeze";
  userPrompt: string | null;
  nextState: PremiumUsageState;
}

export interface PremiumEscalationInput {
  usage: PremiumUsageState;
  freeFailuresForTask: number;
  userApproved: boolean;
}

export interface PremiumEscalationResult {
  escalationRequested: boolean;
  escalationApproved: boolean;
  escalationDeniedDueToLimits: boolean;
  premiumWasUsed: boolean;
  reason:
    | "approved"
    | "free-failure-threshold-not-met"
    | "user-denied"
    | "frozen"
    | "daily-limit"
    | "weekly-limit"
    | "monthly-hard-freeze";
  usage: PremiumUsageState;
}

export interface PremiumWorkflowReport {
  premiumRequestsUsedToday: number;
  premiumRequestsUsedThisWeek: number;
  premiumRequestsUsedThisMonth: number;
  premiumWasUsed: boolean;
  premiumFrozen: boolean;
  escalationRequested: boolean;
  escalationApproved: boolean;
  escalationDeniedDueToLimits: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export const MONTHLY_BASELINE_PERCENT = 8.6;
const DAILY_BASELINE_MULTIPLIER = 0.4;
const WEEKLY_BASELINE_MULTIPLIER = 2.7;
export const MONTHLY_LIMIT_PERCENT = 100;

function roundToOneDecimal(value: number): number {
  return Number(value.toFixed(1));
}

export function getDefaultDailyLimitPercent(): number {
  return roundToOneDecimal(MONTHLY_BASELINE_PERCENT * DAILY_BASELINE_MULTIPLIER);
}

export function getDefaultWeeklyLimitPercent(): number {
  return roundToOneDecimal(MONTHLY_BASELINE_PERCENT * WEEKLY_BASELINE_MULTIPLIER);
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

export function getLocalDateKey(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = pad2(now.getMonth() + 1);
  const day = pad2(now.getDate());
  return `${year}-${month}-${day}`;
}

function getDaysInMonth(year: number, monthIndex: number): number {
  return new Date(year, monthIndex + 1, 0).getDate();
}

function getMonthlyResetAnchor(year: number, monthIndex: number): Date {
  const resetDay = Math.min(31, getDaysInMonth(year, monthIndex));
  return new Date(year, monthIndex, resetDay, 7, 0, 0, 0);
}

function toMonthlyResetKey(anchor: Date): string {
  return `${anchor.getFullYear()}-${pad2(anchor.getMonth() + 1)}-${pad2(anchor.getDate())}@07:00`;
}

export function getMonthlyResetKey(now: Date = new Date()): string {
  const currentAnchor = getMonthlyResetAnchor(now.getFullYear(), now.getMonth());
  if (now.getTime() >= currentAnchor.getTime()) {
    return toMonthlyResetKey(currentAnchor);
  }

  const previousMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const previousAnchor = getMonthlyResetAnchor(previousMonth.getFullYear(), previousMonth.getMonth());
  return toMonthlyResetKey(previousAnchor);
}

export function getIsoWeekKey(now: Date = new Date()): string {
  const utcDate = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const day = utcDate.getUTCDay() || 7;
  utcDate.setUTCDate(utcDate.getUTCDate() + 4 - day);

  const isoYear = utcDate.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const week = Math.ceil((((utcDate.getTime() - yearStart.getTime()) / DAY_MS) + 1) / 7);

  return `${isoYear}-W${pad2(week)}`;
}

export function createDefaultPremiumUsage(now: Date = new Date()): PremiumUsageState {
  return {
    premiumRequestsUsedToday: 0,
    premiumRequestsUsedThisWeek: 0,
    premiumRequestsUsedThisMonth: 0,
    dailyLimitPercent: getDefaultDailyLimitPercent(),
    weeklyLimitPercent: getDefaultWeeklyLimitPercent(),
    monthlyLimitPercent: MONTHLY_LIMIT_PERCENT,
    freezePremium: false,
    lastResetDate: getLocalDateKey(now),
    lastResetWeek: getIsoWeekKey(now),
    lastResetMonth: getMonthlyResetKey(now),
  };
}

export function normalizePremiumUsage(
  value: Partial<PremiumUsageState> | null | undefined,
  now: Date = new Date()
): PremiumUsageState {
  const defaults = createDefaultPremiumUsage(now);
  return {
    premiumRequestsUsedToday: Number(value?.premiumRequestsUsedToday ?? defaults.premiumRequestsUsedToday),
    premiumRequestsUsedThisWeek: Number(value?.premiumRequestsUsedThisWeek ?? defaults.premiumRequestsUsedThisWeek),
    premiumRequestsUsedThisMonth: Number(value?.premiumRequestsUsedThisMonth ?? defaults.premiumRequestsUsedThisMonth),
    dailyLimitPercent: Number(value?.dailyLimitPercent ?? defaults.dailyLimitPercent),
    weeklyLimitPercent: Number(value?.weeklyLimitPercent ?? defaults.weeklyLimitPercent),
    monthlyLimitPercent: Number(value?.monthlyLimitPercent ?? defaults.monthlyLimitPercent),
    freezePremium: value?.freezePremium === true,
    lastResetDate: typeof value?.lastResetDate === "string" ? value.lastResetDate : defaults.lastResetDate,
    lastResetWeek: typeof value?.lastResetWeek === "string" ? value.lastResetWeek : defaults.lastResetWeek,
    lastResetMonth: typeof value?.lastResetMonth === "string" ? value.lastResetMonth : defaults.lastResetMonth,
  };
}

export function applyPremiumResets(
  currentUsage: PremiumUsageState,
  now: Date = new Date()
): { usage: PremiumUsageState; resetApplied: boolean } {
  const dateKey = getLocalDateKey(now);
  const weekKey = getIsoWeekKey(now);
  const monthKey = getMonthlyResetKey(now);
  let resetApplied = false;

  const nextUsage: PremiumUsageState = { ...currentUsage };

  if (currentUsage.lastResetDate !== dateKey) {
    nextUsage.premiumRequestsUsedToday = 0;
    nextUsage.lastResetDate = dateKey;
    resetApplied = true;
  }

  if (currentUsage.lastResetWeek !== weekKey) {
    nextUsage.premiumRequestsUsedThisWeek = 0;
    nextUsage.lastResetWeek = weekKey;
    resetApplied = true;
  }

  if (currentUsage.lastResetMonth !== monthKey) {
    nextUsage.premiumRequestsUsedThisMonth = 0;
    nextUsage.lastResetMonth = monthKey;
    resetApplied = true;
  }

  return { usage: nextUsage, resetApplied };
}

export function evaluatePremiumGate(
  currentUsage: PremiumUsageState,
  now: Date = new Date()
): PremiumGateDecision {
  const normalized = normalizePremiumUsage(currentUsage, now);
  const { usage: resetUsage } = applyPremiumResets(normalized, now);

  if (resetUsage.freezePremium) {
    return {
      allowPremium: false,
      requiresUserApproval: false,
      deniedDueToLimits: true,
      reason: "frozen",
      userPrompt: "Premium usage is frozen due to budget limits. Running in free-only mode.",
      nextState: resetUsage,
    };
  }

  if (resetUsage.premiumRequestsUsedThisMonth > resetUsage.monthlyLimitPercent) {
    return {
      allowPremium: false,
      requiresUserApproval: false,
      deniedDueToLimits: true,
      reason: "monthly-hard-freeze",
      userPrompt: null,
      nextState: {
        ...resetUsage,
        freezePremium: true,
      },
    };
  }

  if (resetUsage.premiumRequestsUsedThisWeek > resetUsage.weeklyLimitPercent) {
    return {
      allowPremium: false,
      requiresUserApproval: true,
      deniedDueToLimits: true,
      reason: "weekly-limit",
      userPrompt: "Weekly premium usage exceeded. Confirm to continue or freeze premium until next week.",
      nextState: resetUsage,
    };
  }

  if (resetUsage.premiumRequestsUsedToday > resetUsage.dailyLimitPercent) {
    return {
      allowPremium: false,
      requiresUserApproval: true,
      deniedDueToLimits: true,
      reason: "daily-limit",
      userPrompt: "Daily premium usage exceeded. Continue with premium or switch to free-only mode?",
      nextState: resetUsage,
    };
  }

  return {
    allowPremium: true,
    requiresUserApproval: false,
    deniedDueToLimits: false,
    reason: "within-limits",
    userPrompt: null,
    nextState: resetUsage,
  };
}

export function applyPremiumFreezeDecision(currentUsage: PremiumUsageState, continueWithPremium: boolean): PremiumUsageState {
  if (continueWithPremium) {
    return { ...currentUsage };
  }

  return {
    ...currentUsage,
    freezePremium: true,
  };
}

export function recordPremiumRequest(currentUsage: PremiumUsageState, count = 1): PremiumUsageState {
  const increment = Math.max(0, count);
  return {
    ...currentUsage,
    premiumRequestsUsedToday: currentUsage.premiumRequestsUsedToday + increment,
    premiumRequestsUsedThisWeek: currentUsage.premiumRequestsUsedThisWeek + increment,
    premiumRequestsUsedThisMonth: currentUsage.premiumRequestsUsedThisMonth + increment,
  };
}

export function attemptPremiumEscalation(input: PremiumEscalationInput, now: Date = new Date()): PremiumEscalationResult {
  const gate = evaluatePremiumGate(input.usage, now);

  if (input.freeFailuresForTask < 3) {
    return {
      escalationRequested: false,
      escalationApproved: false,
      escalationDeniedDueToLimits: false,
      premiumWasUsed: false,
      reason: "free-failure-threshold-not-met",
      usage: gate.nextState,
    };
  }

  if (gate.reason === "frozen") {
    return {
      escalationRequested: true,
      escalationApproved: false,
      escalationDeniedDueToLimits: true,
      premiumWasUsed: false,
      reason: "frozen",
      usage: gate.nextState,
    };
  }

  if (gate.reason === "monthly-hard-freeze") {
    return {
      escalationRequested: true,
      escalationApproved: false,
      escalationDeniedDueToLimits: true,
      premiumWasUsed: false,
      reason: "monthly-hard-freeze",
      usage: gate.nextState,
    };
  }

  if (gate.reason === "daily-limit") {
    return {
      escalationRequested: true,
      escalationApproved: false,
      escalationDeniedDueToLimits: true,
      premiumWasUsed: false,
      reason: "daily-limit",
      usage: gate.nextState,
    };
  }

  if (gate.reason === "weekly-limit") {
    return {
      escalationRequested: true,
      escalationApproved: false,
      escalationDeniedDueToLimits: true,
      premiumWasUsed: false,
      reason: "weekly-limit",
      usage: gate.nextState,
    };
  }

  if (!input.userApproved) {
    return {
      escalationRequested: true,
      escalationApproved: false,
      escalationDeniedDueToLimits: false,
      premiumWasUsed: false,
      reason: "user-denied",
      usage: gate.nextState,
    };
  }

  return {
    escalationRequested: true,
    escalationApproved: true,
    escalationDeniedDueToLimits: false,
    premiumWasUsed: true,
    reason: "approved",
    usage: recordPremiumRequest(gate.nextState, 1),
  };
}

export function buildPremiumWorkflowReport(
  usage: PremiumUsageState,
  detail: {
    premiumWasUsed: boolean;
    escalationRequested: boolean;
    escalationApproved: boolean;
    escalationDeniedDueToLimits: boolean;
  }
): PremiumWorkflowReport {
  return {
    premiumRequestsUsedToday: usage.premiumRequestsUsedToday,
    premiumRequestsUsedThisWeek: usage.premiumRequestsUsedThisWeek,
    premiumRequestsUsedThisMonth: usage.premiumRequestsUsedThisMonth,
    premiumWasUsed: detail.premiumWasUsed,
    premiumFrozen: usage.freezePremium,
    escalationRequested: detail.escalationRequested,
    escalationApproved: detail.escalationApproved,
    escalationDeniedDueToLimits: detail.escalationDeniedDueToLimits,
  };
}
