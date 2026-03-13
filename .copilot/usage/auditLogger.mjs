import fs from "node:fs/promises";
import path from "node:path";

const AUDIT_LOG_PATH = path.resolve(process.cwd(), ".copilot/usage/escalation-audit.jsonl");

async function appendAuditEntry(event) {
  const entry = {
    timestamp: new Date().toISOString(),
    ...event,
  };

  await fs.mkdir(path.dirname(AUDIT_LOG_PATH), { recursive: true });
  await fs.appendFile(AUDIT_LOG_PATH, `${JSON.stringify(entry)}\n`, "utf8");
  return entry;
}

export async function logGateEvaluation(event) {
  return appendAuditEntry({
    eventType: "gate_evaluation",
    ...event,
  });
}

export async function logEscalationDecision(event) {
  return appendAuditEntry({
    eventType: "escalation_decision",
    ...event,
  });
}

export async function logPremiumInvocation(event) {
  return appendAuditEntry({
    eventType: "premium_invoked",
    ...event,
  });
}

export async function logFreezeChange(event) {
  return appendAuditEntry({
    eventType: "freeze_change",
    ...event,
  });
}