import fs from "node:fs/promises";
import path from "node:path";
import {
  logEscalationDecision,
  logFreezeChange,
  logGateEvaluation,
  logPremiumInvocation,
} from "./auditLogger.mjs";

const USAGE_FILE_PATH = path.resolve(process.cwd(), ".copilot/usage/premium-usage.json");
const DAY_MS = 24 * 60 * 60 * 1000;
const MONTHLY_BASELINE_PERCENT = 8.6;
const DAILY_BASELINE_MULTIPLIER = 0.4;
const WEEKLY_BASELINE_MULTIPLIER = 2.7;
const MONTHLY_LIMIT_PERCENT = 100;

function roundToOneDecimal(value) {
  return Number(value.toFixed(1));
}

function getDefaultDailyLimitPercent() {
  return roundToOneDecimal(MONTHLY_BASELINE_PERCENT * DAILY_BASELINE_MULTIPLIER);
}

function getDefaultWeeklyLimitPercent() {
  return roundToOneDecimal(MONTHLY_BASELINE_PERCENT * WEEKLY_BASELINE_MULTIPLIER);
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function getLocalDateKey(now = new Date()) {
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

function getDaysInMonth(year, monthIndex) {
  return new Date(year, monthIndex + 1, 0).getDate();
}

function getMonthlyResetAnchor(year, monthIndex) {
  const resetDay = Math.min(31, getDaysInMonth(year, monthIndex));
  return new Date(year, monthIndex, resetDay, 7, 0, 0, 0);
}

function toMonthlyResetKey(anchor) {
  return `${anchor.getFullYear()}-${pad2(anchor.getMonth() + 1)}-${pad2(anchor.getDate())}@07:00`;
}

function getMonthlyResetKey(now = new Date()) {
  const currentAnchor = getMonthlyResetAnchor(now.getFullYear(), now.getMonth());
  if (now.getTime() >= currentAnchor.getTime()) {
    return toMonthlyResetKey(currentAnchor);
  }

  const previousMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const previousAnchor = getMonthlyResetAnchor(previousMonth.getFullYear(), previousMonth.getMonth());
  return toMonthlyResetKey(previousAnchor);
}

function getIsoWeekKey(now = new Date()) {
  const utcDate = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const day = utcDate.getUTCDay() || 7;
  utcDate.setUTCDate(utcDate.getUTCDate() + 4 - day);

  const isoYear = utcDate.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const week = Math.ceil((((utcDate.getTime() - yearStart.getTime()) / DAY_MS) + 1) / 7);
  return `${isoYear}-W${pad2(week)}`;
}

function createDefaults(now = new Date()) {
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

function normalizeUsage(value, now = new Date()) {
  const defaults = createDefaults(now);
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

function applyResets(usage, now = new Date()) {
  const dateKey = getLocalDateKey(now);
  const weekKey = getIsoWeekKey(now);
  const monthKey = getMonthlyResetKey(now);

  const next = { ...usage };

  if (next.lastResetDate !== dateKey) {
    next.premiumRequestsUsedToday = 0;
    next.lastResetDate = dateKey;
  }

  if (next.lastResetWeek !== weekKey) {
    next.premiumRequestsUsedThisWeek = 0;
    next.lastResetWeek = weekKey;
  }

  if (next.lastResetMonth !== monthKey) {
    next.premiumRequestsUsedThisMonth = 0;
    next.lastResetMonth = monthKey;
  }

  return next;
}

function evaluateGate(usage) {
  if (usage.freezePremium) {
    return {
      allowPremium: false,
      reason: "frozen",
      userPrompt: "Premium usage is frozen due to budget limits. Running in free-only mode.",
    };
  }

  if (usage.premiumRequestsUsedThisMonth > usage.monthlyLimitPercent) {
    return {
      allowPremium: false,
      reason: "monthly-hard-freeze",
      userPrompt: null,
    };
  }

  if (usage.premiumRequestsUsedThisWeek > usage.weeklyLimitPercent) {
    return {
      allowPremium: false,
      reason: "weekly-limit",
      userPrompt: "Weekly premium usage exceeded. Confirm to continue or freeze premium until next week.",
    };
  }

  if (usage.premiumRequestsUsedToday > usage.dailyLimitPercent) {
    return {
      allowPremium: false,
      reason: "daily-limit",
      userPrompt: "Daily premium usage exceeded. Continue with premium or switch to free-only mode?",
    };
  }

  return {
    allowPremium: true,
    reason: "within-limits",
    userPrompt: null,
  };
}

async function evaluateGateWithAudit(usage) {
  const gate = evaluateGate(usage);
  await logGateEvaluation({
    reason: gate.reason,
    allowPremium: gate.allowPremium,
    usageToday: usage.premiumRequestsUsedToday,
    dailyLimit: usage.dailyLimitPercent,
    usageWeek: usage.premiumRequestsUsedThisWeek,
    weeklyLimit: usage.weeklyLimitPercent,
    usageMonth: usage.premiumRequestsUsedThisMonth,
    monthlyLimit: usage.monthlyLimitPercent,
    frozen: usage.freezePremium,
  });
  return gate;
}

export async function readPremiumUsage(now = new Date()) {
  try {
    const raw = await fs.readFile(USAGE_FILE_PATH, "utf8");
    return applyResets(normalizeUsage(JSON.parse(raw), now), now);
  } catch {
    const defaults = createDefaults(now);
    await writePremiumUsage(defaults);
    return defaults;
  }
}

export async function writePremiumUsage(usage) {
  const normalized = normalizeUsage(usage);
  await fs.mkdir(path.dirname(USAGE_FILE_PATH), { recursive: true });
  await fs.writeFile(USAGE_FILE_PATH, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
}

export async function canEscalateToPremium({ freeFailuresForTask, userApproved }) {
  const usage = await readPremiumUsage();
  const gate = await evaluateGateWithAudit(usage);

  if (!gate.allowPremium) {
    if (gate.reason === "monthly-hard-freeze") {
      const frozen = { ...usage, freezePremium: true };
      await writePremiumUsage(frozen);
      await logEscalationDecision({
        decision: "denied",
        reason: gate.reason,
        freeFailuresForTask,
        userApproved,
        usageToday: frozen.premiumRequestsUsedToday,
        usageWeek: frozen.premiumRequestsUsedThisWeek,
        usageMonth: frozen.premiumRequestsUsedThisMonth,
        frozen: frozen.freezePremium,
      });
      return { allowed: false, reason: gate.reason, usage: frozen, userPrompt: gate.userPrompt };
    }

    await logEscalationDecision({
      decision: "denied",
      reason: gate.reason,
      freeFailuresForTask,
      userApproved,
      usageToday: usage.premiumRequestsUsedToday,
      usageWeek: usage.premiumRequestsUsedThisWeek,
      usageMonth: usage.premiumRequestsUsedThisMonth,
      frozen: usage.freezePremium,
    });

    return { allowed: false, reason: gate.reason, usage, userPrompt: gate.userPrompt };
  }

  if (freeFailuresForTask < 3) {
    await logEscalationDecision({
      decision: "denied",
      reason: "free-failure-threshold-not-met",
      freeFailuresForTask,
      userApproved,
      usageToday: usage.premiumRequestsUsedToday,
      usageWeek: usage.premiumRequestsUsedThisWeek,
      usageMonth: usage.premiumRequestsUsedThisMonth,
      frozen: usage.freezePremium,
    });
    return { allowed: false, reason: "free-failure-threshold-not-met", usage, userPrompt: null };
  }

  if (!userApproved) {
    await logEscalationDecision({
      decision: "denied",
      reason: "user-denied",
      freeFailuresForTask,
      userApproved,
      usageToday: usage.premiumRequestsUsedToday,
      usageWeek: usage.premiumRequestsUsedThisWeek,
      usageMonth: usage.premiumRequestsUsedThisMonth,
      frozen: usage.freezePremium,
    });
    return { allowed: false, reason: "user-denied", usage, userPrompt: null };
  }

  await logEscalationDecision({
    decision: "approved",
    reason: "approved",
    freeFailuresForTask,
    userApproved,
    usageToday: usage.premiumRequestsUsedToday,
    usageWeek: usage.premiumRequestsUsedThisWeek,
    usageMonth: usage.premiumRequestsUsedThisMonth,
    frozen: usage.freezePremium,
  });

  return { allowed: true, reason: "approved", usage, userPrompt: null };
}

export async function recordPremiumInvocation(increment = 1) {
  const usage = await readPremiumUsage();
  const safeIncrement = Math.max(0, increment);
  const next = {
    ...usage,
    premiumRequestsUsedToday: usage.premiumRequestsUsedToday + safeIncrement,
    premiumRequestsUsedThisWeek: usage.premiumRequestsUsedThisWeek + safeIncrement,
    premiumRequestsUsedThisMonth: usage.premiumRequestsUsedThisMonth + safeIncrement,
  };

  await writePremiumUsage(next);
  await logPremiumInvocation({
    incrementBy: safeIncrement,
    newDailyCount: next.premiumRequestsUsedToday,
    newWeeklyCount: next.premiumRequestsUsedThisWeek,
    newMonthlyCount: next.premiumRequestsUsedThisMonth,
  });
  return next;
}

export async function setPremiumFreeze(freezePremium) {
  const usage = await readPremiumUsage();
  const next = {
    ...usage,
    freezePremium: Boolean(freezePremium),
  };

  await writePremiumUsage(next);
  await logFreezeChange({
    previousFrozen: usage.freezePremium,
    frozen: next.freezePremium,
  });
  return next;
}

export function buildWorkflowSummary(usage, details) {
  return {
    premiumRequestsUsedToday: usage.premiumRequestsUsedToday,
    premiumRequestsUsedThisWeek: usage.premiumRequestsUsedThisWeek,
    premiumRequestsUsedThisMonth: usage.premiumRequestsUsedThisMonth,
    premiumWasUsed: details.premiumWasUsed === true,
    premiumFrozen: usage.freezePremium === true,
    escalationRequested: details.escalationRequested === true,
    escalationApproved: details.escalationApproved === true,
    escalationDeniedDueToLimits: details.escalationDeniedDueToLimits === true,
  };
}
