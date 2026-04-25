import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const MEMPALACE_DIR = path.join(ROOT, ".mempalace");
const PORT_FILE = path.join(MEMPALACE_DIR, "port.json");
const LOG_DIR = path.join(ROOT, ".courseforge", "logs");
const LOG_FILE = path.join(LOG_DIR, "mempalace-watchdog.log");
const DEFAULT_PORT = 3929;
const MAX_PORT_SCAN = 50;
const DEFAULT_HOST = "127.0.0.1";

function nowIso() {
  return new Date().toISOString();
}

function ensureLogDir() {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

function log(level, message, extra = undefined) {
  ensureLogDir();
  const payload = {
    ts: nowIso(),
    level,
    message,
    ...(extra ? { extra } : {}),
  };
  fs.appendFileSync(LOG_FILE, `${JSON.stringify(payload)}\n`, "utf8");
}

function parseArgs(argv) {
  const args = {
    watch: true,
    once: false,
    intervalMs: 3000,
    port: undefined,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--once") {
      args.once = true;
      args.watch = false;
      continue;
    }
    if (token === "--watch") {
      args.watch = true;
      args.once = false;
      continue;
    }
    if (token === "--port" && argv[i + 1]) {
      args.port = Number(argv[i + 1]);
      i += 1;
      continue;
    }
    if (token === "--intervalMs" && argv[i + 1]) {
      args.intervalMs = Number(argv[i + 1]);
      i += 1;
    }
  }

  if (!Number.isFinite(args.intervalMs)) {
    args.intervalMs = 3000;
  }
  args.intervalMs = Math.min(5000, Math.max(2000, args.intervalMs));

  return args;
}

function readPortFromFile() {
  try {
    const raw = fs.readFileSync(PORT_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (Number.isInteger(parsed.port) && parsed.port > 0) {
      return {
        port: parsed.port,
        pid: Number.isInteger(parsed.pid) && parsed.pid > 0 ? parsed.pid : null,
        palaceRoot: typeof parsed.palace_root === "string" ? parsed.palace_root : null,
      };
    }
  } catch {
    // Ignore malformed or missing port file.
  }
  return undefined;
}

function getExpectedPort(cliPort) {
  if (Number.isInteger(cliPort) && cliPort > 0) {
    return cliPort;
  }
  const filePort = readPortFromFile();
  if (filePort && Number.isInteger(filePort.port) && filePort.port > 0) {
    return filePort.port;
  }
  return DEFAULT_PORT;
}

function isCurrentPalaceByPortRecord(pid, port) {
  const record = readPortFromFile();
  if (!record || !record.pid || !record.port) {
    return false;
  }

  if (record.pid !== pid || record.port !== port) {
    return false;
  }

  if (!record.palaceRoot) {
    return true;
  }

  return path.resolve(record.palaceRoot) === MEMPALACE_DIR;
}

function findAvailablePort(startPort) {
  const seedPort = Number.isInteger(startPort) && startPort > 0 ? startPort : DEFAULT_PORT;
  for (let offset = 0; offset <= MAX_PORT_SCAN; offset += 1) {
    const candidate = seedPort + offset;
    const pid = getListeningPid(candidate);
    if (!pid) {
      return candidate;
    }

    const details = getProcessDetails(pid);
    if (isMempalaceProcess(details) && isCurrentPalaceProcess(details)) {
      return candidate;
    }
  }

  return null;
}

function runPowerShell(script) {
  return spawnSync(
    "powershell",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
    { cwd: ROOT, encoding: "utf8", windowsHide: true }
  );
}

function getListeningPid(port) {
  const script = [
    `$conn = Get-NetTCPConnection -State Listen -LocalPort ${port} -ErrorAction SilentlyContinue | Select-Object -First 1`,
    "if ($conn) { $conn.OwningProcess }",
  ].join("; ");
  const result = runPowerShell(script);
  const pid = Number((result.stdout || "").trim());
  if (Number.isInteger(pid) && pid > 0) {
    return pid;
  }

  const netstat = spawnSync("netstat", ["-ano", "-p", "tcp"], {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
  });
  const lines = (netstat.stdout || "").split(/\r?\n/);
  for (const line of lines) {
    const normalized = line.trim().replace(/\s+/g, " ");
    if (!normalized.includes(" LISTENING ")) {
      continue;
    }
    const parts = normalized.split(" ");
    if (parts.length < 5) {
      continue;
    }
    const local = parts[1];
    if (!local.endsWith(`:${port}`)) {
      continue;
    }
    const parsedPid = Number(parts[4]);
    if (Number.isInteger(parsedPid) && parsedPid > 0) {
      return parsedPid;
    }
  }

  return null;
}

function getProcessDetails(pid) {
  const script = [
    `$p = Get-CimInstance Win32_Process -Filter \"ProcessId = ${pid}\" -ErrorAction SilentlyContinue`,
    "if ($p) { [pscustomobject]@{ Name = $p.Name; CommandLine = $p.CommandLine } | ConvertTo-Json -Compress }",
  ].join("; ");
  const result = runPowerShell(script);
  const raw = (result.stdout || "").trim();
  if (!raw) {
    return { name: "unknown", commandLine: "" };
  }
  try {
    const parsed = JSON.parse(raw);
    return {
      name: String(parsed.Name || "unknown"),
      commandLine: String(parsed.CommandLine || ""),
    };
  } catch {
    return { name: "unknown", commandLine: raw };
  }
}

function isMempalaceProcess(details) {
  const haystack = `${details.name} ${details.commandLine}`.toLowerCase();
  return haystack.includes("mempalace");
}

function isCurrentPalaceProcess(details) {
  const normalizedCmd = String(details.commandLine || "").toLowerCase().replace(/\//g, "\\");
  const normalizedPalace = MEMPALACE_DIR.toLowerCase().replace(/\//g, "\\");
  return normalizedCmd.includes(normalizedPalace);
}

function getMempalaceCandidatesForCurrentPalace() {
  const escapedPalacePath = MEMPALACE_DIR.replace(/\\/g, "\\\\");
  const script = [
    "$rows = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |",
    `  Where-Object { $_.CommandLine -and $_.CommandLine -like '*mempalace*serve*' -and $_.CommandLine -like '*${escapedPalacePath}*' } |`,
    "  Select-Object ProcessId,CommandLine",
    "if ($rows) { $rows | ConvertTo-Json -Compress }",
  ].join("; ");

  const result = runPowerShell(script);
  const raw = (result.stdout || "").trim();
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.map((item) => ({
        pid: Number(item.ProcessId),
        commandLine: String(item.CommandLine || ""),
      }));
    }

    return [{
      pid: Number(parsed.ProcessId),
      commandLine: String(parsed.CommandLine || ""),
    }];
  } catch {
    return [];
  }
}

async function stopDuplicateMempalaceProcesses(expectedPort) {
  const expectedToken = `--port ${expectedPort}`;
  const candidates = getMempalaceCandidatesForCurrentPalace();

  for (const candidate of candidates) {
    if (!Number.isInteger(candidate.pid) || candidate.pid <= 0 || candidate.pid === process.pid) {
      continue;
    }

    const commandLine = candidate.commandLine.toLowerCase();
    if (commandLine.includes(expectedToken.toLowerCase())) {
      continue;
    }

    log("warn", "Duplicate MemPalace instance detected for same palace; stopping duplicate", {
      pid: candidate.pid,
      expectedPort,
      commandLine: candidate.commandLine,
    });
    await killPid(candidate.pid, "Duplicate MemPalace process for same palace root");
  }
}

function tcpPing(host, port, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;

    const done = (ok) => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      resolve(ok);
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));

    socket.connect(port, host);
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function killPid(pid, reason) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return;
  }
  if (pid === process.pid) {
    return;
  }

  log("warn", "Killing process holding MemPalace port", { pid, reason });

  spawnSync("taskkill", ["/PID", String(pid), "/T"], {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
  });

  await sleep(400);

  const stillAlive = !!getProcessDetails(pid).commandLine;
  if (stillAlive) {
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
      cwd: ROOT,
      encoding: "utf8",
      windowsHide: true,
    });
  }
}

function writePortFile(port, pid) {
  fs.mkdirSync(MEMPALACE_DIR, { recursive: true });
  const payload = {
    host: DEFAULT_HOST,
    port,
    transport: "tcp",
    pid,
    updated_at: new Date().toISOString(),
    palace_root: MEMPALACE_DIR,
    palace_path: path.join(MEMPALACE_DIR, "palace"),
  };
  fs.writeFileSync(PORT_FILE, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function startMempalace(port) {
  log("info", "Starting MemPalace", { port });

  const child = spawn("mempalace", ["serve", MEMPALACE_DIR, "--port", String(port)], {
    cwd: ROOT,
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();

  for (let attempt = 1; attempt <= 20; attempt += 1) {
    const healthy = await tcpPing(DEFAULT_HOST, port);
    if (healthy) {
      const pid = getListeningPid(port);
      const details = pid ? getProcessDetails(pid) : { name: "unknown", commandLine: "" };
      const isMempalace = pid ? isMempalaceProcess(details) : false;
      const isCurrentPalace = pid ? isCurrentPalaceProcess(details) : false;

      if (pid && isMempalace && isCurrentPalace) {
        writePortFile(port, pid);
        log("info", "MemPalace became healthy", { port, pid, attempt });
        return { ok: true, port };
      }

      log("warn", "Healthy listener on target port does not belong to current MemPalace", {
        port,
        pid,
        attempt,
        details,
      });

      const fallbackPort = findAvailablePort(port + 1);
      if (fallbackPort && fallbackPort !== port) {
        log("warn", "Retrying MemPalace startup on adaptive port after ownership mismatch", {
          previousPort: port,
          selectedPort: fallbackPort,
        });
        return startMempalace(fallbackPort);
      }

      break;
    }
    await sleep(500);
  }

  log("error", "MemPalace failed health check after restart", { port });
  return { ok: false, port };
}

async function ensureMempalace(port) {
  if (!fs.existsSync(MEMPALACE_DIR)) {
    log("error", "Missing .mempalace directory; cannot start watchdog", { path: MEMPALACE_DIR });
    return { ok: false, port };
  }

  let targetPort = port;
  const candidatePort = findAvailablePort(port);
  if (!candidatePort) {
    log("error", "Failed to find an available MemPalace port", { requestedPort: port, scanWindow: MAX_PORT_SCAN + 1 });
    return { ok: false, port };
  }

  if (candidatePort !== port) {
    log("warn", "Switching MemPalace to adaptive port", { previousPort: port, selectedPort: candidatePort });
    targetPort = candidatePort;
  }

  await stopDuplicateMempalaceProcesses(targetPort);

  const pid = getListeningPid(targetPort);
  if (!pid) {
    log("warn", "MemPalace port is closed; restarting", { port: targetPort });
    return startMempalace(targetPort);
  }

  const details = getProcessDetails(pid);
  const healthy = await tcpPing(DEFAULT_HOST, targetPort);
  const isMempalace = isMempalaceProcess(details);
  const isCurrentPalace = isCurrentPalaceProcess(details) || isCurrentPalaceByPortRecord(pid, targetPort);

  if (healthy && isMempalace && isCurrentPalace) {
    writePortFile(targetPort, pid);
    return { ok: true, port: targetPort };
  }

  if (healthy && isMempalace && !isCurrentPalace) {
    const fallbackPort = findAvailablePort(targetPort + 1);
    if (fallbackPort) {
      log("warn", "MemPalace port is owned by another project's palace; moving to free port", {
        previousPort: targetPort,
        selectedPort: fallbackPort,
        pid,
        details,
      });
      return startMempalace(fallbackPort);
    }

    log("error", "MemPalace port is owned by another project's palace and no adaptive port was found", {
      port: targetPort,
      pid,
      details,
      currentPalace: MEMPALACE_DIR,
    });
    return { ok: false, port: targetPort };
  }

  if (!isMempalace) {
    const fallbackPort = findAvailablePort(targetPort + 1);
    if (fallbackPort) {
      log("warn", "Port collision detected on MemPalace port; selecting adaptive port", {
        previousPort: targetPort,
        selectedPort: fallbackPort,
        pid,
        details,
      });
      return startMempalace(fallbackPort);
    }

    log("error", "Port collision detected and no adaptive port available", { port: targetPort, pid, details });
    return { ok: false, port: targetPort };
  }

  log("warn", "MemPalace process is unresponsive; recycling process", { port: targetPort, pid, details });
  await killPid(pid, "Unresponsive MemPalace process");
  return startMempalace(targetPort);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let port = getExpectedPort(args.port);

  log("info", "MemPalace watchdog started", {
    mode: args.once ? "once" : "watch",
    port,
    intervalMs: args.intervalMs,
    project: "CourseForge",
  });

  const startup = await ensureMempalace(port);
  if (!startup.ok) {
    process.exitCode = 1;
    return;
  }
  port = startup.port;

  if (args.once) {
    return;
  }

  let running = false;
  const timer = setInterval(async () => {
    if (running) {
      return;
    }
    running = true;
    try {
      const state = await ensureMempalace(port);
      if (!state.ok) {
        log("error", "Watchdog failed to heal MemPalace", { port });
      } else if (state.port !== port) {
        log("info", "Watchdog switched MemPalace port", { previousPort: port, selectedPort: state.port });
        port = state.port;
      }
    } catch (error) {
      log("error", "Watchdog loop failure", {
        port,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      running = false;
    }
  }, args.intervalMs);

  const shutdown = () => {
    clearInterval(timer);
    log("info", "MemPalace watchdog stopped", { port });
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  log("error", "Fatal watchdog error", {
    error: error instanceof Error ? error.stack || error.message : String(error),
  });
  process.exit(1);
});
