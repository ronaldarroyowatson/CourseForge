import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";

const defaultPorts = [3000, 8080, 9090, 9150];
const strictMode = String(process.env.COURSEFORGE_PORT_PREFLIGHT_STRICT || "0") === "1";

function parseArgs(argv) {
  const parsed = {
    context: "unspecified",
    ports: [...defaultPorts],
    force: true,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--context") {
      parsed.context = String(argv[index + 1] || parsed.context);
      index += 1;
      continue;
    }

    if (value === "--ports") {
      const portValues = String(argv[index + 1] || "")
        .split(",")
        .map((entry) => Number(entry.trim()))
        .filter((entry) => Number.isFinite(entry) && entry > 0 && entry <= 65535);
      if (portValues.length > 0) {
        parsed.ports = Array.from(new Set(portValues.values())).sort((left, right) => left - right);
      }
      index += 1;
      continue;
    }

    if (value === "--no-force") {
      parsed.force = false;
    }
  }

  return parsed;
}

function findPidByPort(port) {
  try {
    if (process.platform === "win32") {
      const output = execSync(`netstat -ano -p tcp | findstr :${port}`, {
        stdio: ["ignore", "pipe", "ignore"],
      }).toString("utf8");
      const lines = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      for (const line of lines) {
        const parts = line.split(/\s+/);
        const pid = Number(parts[parts.length - 1]);
        if (Number.isFinite(pid) && pid > 0 && pid !== process.pid) {
          return pid;
        }
      }
      return null;
    }

    const output = execSync(`lsof -i tcp:${port} -sTCP:LISTEN -t`, {
      stdio: ["ignore", "pipe", "ignore"],
    }).toString("utf8").trim();
    const pid = Number(output.split(/\r?\n/)[0]);
    return Number.isFinite(pid) && pid > 0 && pid !== process.pid ? pid : null;
  } catch {
    return null;
  }
}

function killPid(pid) {
  const numeric = Number(pid);
  if (!Number.isFinite(numeric) || numeric <= 0 || numeric === process.pid) {
    return false;
  }

  try {
    process.kill(numeric, "SIGTERM");
    return true;
  } catch {
    return false;
  }
}

function forceKillPid(pid) {
  const numeric = Number(pid);
  if (!Number.isFinite(numeric) || numeric <= 0 || numeric === process.pid) {
    return false;
  }

  try {
    if (process.platform === "win32") {
      execSync(`taskkill /PID ${numeric} /F`, {
        stdio: ["ignore", "ignore", "ignore"],
      });
      return true;
    }

    process.kill(numeric, "SIGKILL");
    return true;
  } catch {
    return false;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const records = [];

  for (const port of args.ports) {
    const holderPid = findPidByPort(port);
    if (!holderPid) {
      records.push({
        port,
        stateBefore: "free",
        holderPid: null,
        gracefulAttempted: false,
        gracefulResult: false,
        forceAttempted: false,
        forceResult: false,
        stateAfter: "free",
        unresolved: false,
      });
      continue;
    }

    let gracefulAttempted = true;
    const gracefulResult = killPid(holderPid);
    if (gracefulResult) {
      await sleep(250);
    }

    let stateAfterGracefulPid = findPidByPort(port);
    let forceAttempted = false;
    let forceResult = false;

    if (stateAfterGracefulPid && args.force) {
      forceAttempted = true;
      forceResult = forceKillPid(stateAfterGracefulPid);
      if (forceResult) {
        await sleep(300);
      }
      stateAfterGracefulPid = findPidByPort(port);
    }

    records.push({
      port,
      stateBefore: "occupied",
      holderPid,
      gracefulAttempted,
      gracefulResult,
      forceAttempted,
      forceResult,
      stateAfter: stateAfterGracefulPid ? "occupied" : "free",
      unresolved: Boolean(stateAfterGracefulPid),
      finalHolderPid: stateAfterGracefulPid || null,
    });
  }

  const unresolvedPorts = records.filter((entry) => entry.unresolved).map((entry) => entry.port);
  const report = {
    context: args.context,
    at: new Date().toISOString(),
    strictMode,
    ports: args.ports,
    unresolvedPorts,
    records,
  };

  const outDir = join(process.cwd(), "tmp-smoke", "port-preflight");
  mkdirSync(outDir, { recursive: true });
  const latestPath = join(outDir, "latest.json");
  const historyPath = join(outDir, "history.ndjson");
  writeFileSync(latestPath, JSON.stringify(report, null, 2), "utf8");
  appendFileSync(historyPath, `${JSON.stringify(report)}\n`, "utf8");

  const summary = `[port-preflight] context=${args.context} unresolved=${unresolvedPorts.length ? unresolvedPorts.join(",") : "none"}`;
  if (unresolvedPorts.length > 0) {
    console.warn(summary);
    if (strictMode) {
      process.exit(1);
    }
  } else {
    console.log(summary);
  }
}

void run();
