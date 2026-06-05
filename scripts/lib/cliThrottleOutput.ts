export type CountdownWriter = (text: string) => void;

export type CountdownOptions = {
  seconds: number;
  label: string;
  channel?: string;
  write?: CountdownWriter;
  sleepMs?: (ms: number) => Promise<void>;
};

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function formatInlineCountdownFrame(channel: string, label: string, remainingSeconds: number): string {
  return `\r[${channel}] ${label}: ${remainingSeconds}s remaining...   `;
}

export function formatInlineCountdownComplete(channel: string, label: string): string {
  return `\r[${channel}] ${label}: 0s remaining.           \n`;
}

export async function runInlineCountdown(options: CountdownOptions): Promise<void> {
  const channel = options.channel || "cli-throttle";
  const write = options.write || ((text) => process.stdout.write(text));
  const sleepMs = options.sleepMs || defaultSleep;

  let remaining = Math.max(0, Math.floor(options.seconds));
  if (remaining <= 0) {
    return;
  }

  while (remaining > 0) {
    write(formatInlineCountdownFrame(channel, options.label, remaining));
    const tick = remaining > 60 ? 15 : remaining > 15 ? 5 : 1;
    const sleepFor = Math.min(tick, remaining);
    await sleepMs(sleepFor * 1000);
    remaining -= sleepFor;
  }

  write(formatInlineCountdownComplete(channel, options.label));
}
