import { describe, expect, it } from "vitest";

import {
  formatInlineCountdownComplete,
  formatInlineCountdownFrame,
  runInlineCountdown,
} from "../../scripts/lib/cliThrottleOutput";

describe("cli throttle output formatter", () => {
  it("renders countdown frames as single-line carriage-return updates", () => {
    const frame = formatInlineCountdownFrame("cli-throttle", "Retry cooldown", 12);
    expect(frame.startsWith("\r")).toBe(true);
    expect(frame.includes("Retry cooldown: 12s remaining...")).toBe(true);
    expect(frame.includes("\n")).toBe(false);
  });

  it("renders countdown completion with trailing newline", () => {
    const complete = formatInlineCountdownComplete("cli-throttle", "Retry cooldown");
    expect(complete.startsWith("\r")).toBe(true);
    expect(complete.endsWith("\n")).toBe(true);
    expect(complete.includes("0s remaining.")).toBe(true);
  });

  it("emits inline updates and one final newline", async () => {
    const writes: string[] = [];
    const sleepCalls: number[] = [];

    await runInlineCountdown({
      seconds: 3,
      label: "Batch cooldown",
      write: (text) => writes.push(text),
      sleepMs: async (ms) => {
        sleepCalls.push(ms);
      },
    });

    expect(writes.length).toBeGreaterThanOrEqual(2);
    expect(writes[0].startsWith("\r[cli-throttle] Batch cooldown: 3s remaining...")).toBe(true);
    expect(writes[writes.length - 1].endsWith("\n")).toBe(true);
    expect(writes.slice(0, -1).every((entry) => !entry.includes("\n"))).toBe(true);
    expect(sleepCalls).toEqual([1000, 1000, 1000]);
  });
});
