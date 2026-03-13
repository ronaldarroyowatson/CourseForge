import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const appendFile = vi.fn(async (_filePath: string, _content: string, _encoding: string) => undefined);
const mkdir = vi.fn(async (_dirPath: string, _options: { recursive: boolean }) => undefined);

vi.mock("node:fs/promises", () => ({
  default: {
    appendFile,
    mkdir,
  },
}));

describe("copilot audit logger", () => {
  beforeEach(() => {
    vi.resetModules();
    appendFile.mockClear();
    mkdir.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("appends JSONL entries for escalation decisions", async () => {
    const logger = await import("../../.copilot/usage/auditLogger.mjs");
    await logger.logEscalationDecision({ decision: "approved", reason: "approved" });

    expect(mkdir).toHaveBeenCalledTimes(1);
    expect(appendFile).toHaveBeenCalledTimes(1);
    const payload = appendFile.mock.calls[0]?.[1] as string | undefined;
    expect(typeof payload).toBe("string");
    expect(payload).toContain("escalation_decision");
    expect(payload).toContain("approved");
    expect(payload ?? "").toMatch(/\n$/);
  });

  it("writes gate and freeze audit events", async () => {
    const logger = await import("../../.copilot/usage/auditLogger.mjs");
    await logger.logGateEvaluation({ reason: "daily-limit", allowPremium: false });
    await logger.logFreezeChange({ previousFrozen: false, frozen: true });

    expect(appendFile).toHaveBeenCalledTimes(2);
    expect(appendFile.mock.calls[0]?.[1] as string).toContain("gate_evaluation");
    expect(appendFile.mock.calls[1]?.[1] as string).toContain("freeze_change");
  });
});
