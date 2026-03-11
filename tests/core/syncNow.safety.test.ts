import { beforeEach, describe, expect, it } from "vitest";
import {
  resetSyncSafetyStateForTests,
  setWriteBudgetStateForTests,
  syncNow,
} from "../../src/core/services/syncService";

function createPendingDiagnostics() {
  return {
    pendingCount: 0,
    byStore: {
      textbooks: 0,
      chapters: 0,
      sections: 0,
      vocabTerms: 0,
    },
  };
}

describe("syncNow safety controls", () => {
  beforeEach(() => {
    resetSyncSafetyStateForTests();
  });

  it("returns throttled result when called within throttle window", async () => {
    const deps = {
      nowFn: () => 6000,
      getCurrentUserFn: () => ({ uid: "user-1" }),
      getPendingSyncDiagnosticsFn: async () => createPendingDiagnostics(),
      syncUserDataFn: async () => Promise.resolve(),
    };

    const first = await syncNow(deps);
    expect(first.success).toBe(true);

    const throttled = await syncNow({
      ...deps,
      nowFn: () => 6200,
    });

    expect(throttled.throttled).toBe(true);
    expect(throttled.success).toBe(false);
    expect(throttled.message).toContain("excessive write frequency");
  });

  it("returns budget-exceeded result when write budget is exhausted", async () => {
    setWriteBudgetStateForTests(true, 500);

    const result = await syncNow({
      nowFn: () => 7000,
      getCurrentUserFn: () => ({ uid: "user-1" }),
      getPendingSyncDiagnosticsFn: async () => createPendingDiagnostics(),
      syncUserDataFn: async () => Promise.resolve(),
    });

    expect(result.success).toBe(false);
    expect(result.writeBudgetExceeded).toBe(true);
    expect(result.writeCount).toBe(500);
    expect(result.message).toContain("Cloud sync paused");
  });

  it("marks permission denied errors correctly", async () => {
    const result = await syncNow({
      nowFn: () => 10000,
      getCurrentUserFn: () => ({ uid: "user-1" }),
      getPendingSyncDiagnosticsFn: async () => createPendingDiagnostics(),
      syncUserDataFn: async () => {
        throw { code: "permission-denied", message: "Denied by rules" };
      },
    });

    expect(result.success).toBe(false);
    expect(result.permissionDenied).toBe(true);
    expect(result.errorCode).toBe("permission-denied");
  });
});
