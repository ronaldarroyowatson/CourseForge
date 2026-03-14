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
      equations: 0,
      concepts: 0,
      keyIdeas: 0,
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

  it("preserves wrapped permission-denied code from lower sync layer", async () => {
    const result = await syncNow({
      nowFn: () => 11000,
      getCurrentUserFn: () => ({ uid: "user-1" }),
      getPendingSyncDiagnosticsFn: async () => createPendingDiagnostics(),
      syncUserDataFn: async () => {
        const firebaseError = { code: "permission-denied", message: "Denied by rules" };
        throw new Error("syncUserData failed", { cause: firebaseError });
      },
    });

    expect(result.success).toBe(false);
    expect(result.permissionDenied).toBe(true);
    expect(result.errorCode).toBe("permission-denied");
  });

  it("preserves wrapped unauthenticated and unavailable codes from lower sync layer", async () => {
    const codes: Array<"unauthenticated" | "unavailable"> = ["unauthenticated", "unavailable"];

    for (const code of codes) {
      resetSyncSafetyStateForTests();

      const result = await syncNow({
        nowFn: () => 12000,
        getCurrentUserFn: () => ({ uid: "user-1" }),
        getPendingSyncDiagnosticsFn: async () => createPendingDiagnostics(),
        syncUserDataFn: async () => {
          const firebaseError = { code, message: `Wrapped ${code}` };
          throw new Error("syncUserData failed", { cause: firebaseError });
        },
      });

      expect(result.success).toBe(false);
      expect(result.permissionDenied).toBe(false);
      expect(result.errorCode).toBe(code);
    }
  });

  it("unauthenticated branch returns expected shape with all required guardrail keys", async () => {
    const result = await syncNow({
      nowFn: () => 99000,
      getCurrentUserFn: () => null,
      getPendingSyncDiagnosticsFn: async () => createPendingDiagnostics(),
      syncUserDataFn: async () => Promise.resolve(),
    });

    expect(result.success).toBe(false);
    expect(result.retryable).toBe(false);
    expect(result.permissionDenied).toBe(false);
    expect(result.throttled).toBe(false);
    // All guardrail keys must be present and correctly typed
    expect(result).toHaveProperty("writeBudgetLimit");
    expect(result).toHaveProperty("retryLimit");
    expect(result).toHaveProperty("pendingCount");
    expect(result).toHaveProperty("errorCode");
    expect(result.errorCode).toBeNull();
    expect(result.pendingCount).toBe(0);
  });

  it("throttled branch carries all guardrail keys and the expected message", async () => {
    const sharedDeps = {
      nowFn: () => 80000,
      getCurrentUserFn: () => ({ uid: "user-throttle-keys" }),
      getPendingSyncDiagnosticsFn: async () => createPendingDiagnostics(),
      syncUserDataFn: async () => Promise.resolve(),
    };

    // First call at t=80000 anchors lastSyncAttemptAt; second call 1ms later is throttled
    const first = await syncNow(sharedDeps);
    expect(first.success).toBe(true);

    const result = await syncNow({ ...sharedDeps, nowFn: () => 80001 });

    expect(result.throttled).toBe(true);
    expect(result.success).toBe(false);
    expect(result.retryable).toBe(false);
    expect(result.permissionDenied).toBe(false);
    expect(result.message).toContain("excessive write frequency");
    expect(result).toHaveProperty("writeBudgetLimit");
    expect(result).toHaveProperty("retryLimit");
    expect(result).toHaveProperty("pendingCount");
    expect(result.errorCode).toBeNull();
  });
});
