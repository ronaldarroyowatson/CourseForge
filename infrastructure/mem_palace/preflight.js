import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..", "..");
const MEMPALACE_DIR = path.join(ROOT, ".mempalace");
const PORT_FILE = path.join(MEMPALACE_DIR, "port.json");
const DEBUG_DIR = path.join(ROOT, ".debug", "mempalace");
const DEFAULT_PORT = 3929;
const DEFAULT_HOST = "127.0.0.1";

function getMode() {
  const flag = String(process.env.CF_DEV_MODE || "").trim().toLowerCase();
  if (flag === "server") {
    return "relaxed";
  }
  if (flag === "agent") {
    return "strict";
  }
  return "strict";
}

function timestampForFile(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return [
    String(date.getFullYear()),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    "_",
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join("");
}

function runPowerShell(script) {
  return spawnSync(
    "powershell",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
    { cwd: ROOT, encoding: "utf8", windowsHide: true }
  );
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
  return { port: DEFAULT_PORT, pid: null, palaceRoot: null };
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

function tcpPing(host, port, timeoutMs = 1200) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;

    const done = (ok, reason = null) => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      resolve({ ok, reason });
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false, "timeout"));
    socket.once("error", (error) => done(false, error instanceof Error ? error.message : String(error)));

    socket.connect(port, host);
  });
}

function writeDebugArtifact(payload) {
  fs.mkdirSync(DEBUG_DIR, { recursive: true });
  const fileName = `preflight_${timestampForFile()}.json`;
  const filePath = path.join(DEBUG_DIR, fileName);
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return filePath;
}

async function collectDiagnostics() {
  const timestamp = new Date().toISOString();
  const mode = getMode();
  const errors = [];
  const portRecord = readPortFromFile();
  const port = portRecord.port;
  const detectedPid = getListeningPid(port);
  const pid = detectedPid ?? portRecord.pid;
  const processDetails = detectedPid ? getProcessDetails(detectedPid) : { name: "none", commandLine: "" };
  const healthCheck = await tcpPing(DEFAULT_HOST, port);
  const isMempalace = detectedPid ? isMempalaceProcess(processDetails) : false;
  const matchesPortRecord =
    !!detectedPid &&
    !!portRecord.pid &&
    portRecord.pid === detectedPid &&
    portRecord.port === port &&
    (portRecord.palaceRoot ? path.resolve(portRecord.palaceRoot) === MEMPALACE_DIR : true);
  const isCurrentPalace = detectedPid ? isCurrentPalaceProcess(processDetails) || matchesPortRecord : false;

  let mempalaceStatus = "missing";
  if (!detectedPid) {
    mempalaceStatus = "missing";
    errors.push("No listening process found on MemPalace port.");
  } else if (!isMempalace) {
    mempalaceStatus = "occupied_by_other_process";
    errors.push("Configured MemPalace port is occupied by a non-MemPalace process.");
  } else if (!isCurrentPalace) {
    mempalaceStatus = "running_from_other_project";
    errors.push("MemPalace process belongs to a different palace root.");
  } else if (!healthCheck.ok) {
    mempalaceStatus = "unhealthy";
    errors.push(`MemPalace health check failed (${healthCheck.reason || "unknown"}).`);
  } else {
    mempalaceStatus = "healthy";
  }

  const strictOk = mempalaceStatus === "healthy";
  const ok = mode === "strict" ? strictOk : true;

  const result = {
    timestamp,
    mode,
    mempalaceStatus,
    port,
    pid,
    healthCheck: {
      host: DEFAULT_HOST,
      port,
      reachable: healthCheck.ok,
      detail: healthCheck.reason,
      isMempalaceProcess: isMempalace,
      isCurrentProjectPalace: isCurrentPalace,
      processName: processDetails.name,
      processCommandLine: processDetails.commandLine,
    },
    errors,
    ok,
  };

  const artifactPath = writeDebugArtifact(result);
  return { result, artifactPath };
}

async function main() {
  try {
    const { result, artifactPath } = await collectDiagnostics();

    if (!result.ok) {
      console.error("[MemPalace preflight] strict mode failed.");
      console.error(JSON.stringify({ ...result, artifactPath }, null, 2));
      process.exitCode = 1;
      return;
    }

    if (result.mode === "relaxed" && result.mempalaceStatus !== "healthy") {
      console.warn("[MemPalace preflight] relaxed mode warning: MemPalace is optional for dev server startup.");
      console.warn(JSON.stringify({ ...result, artifactPath }, null, 2));
      process.exitCode = 0;
      return;
    }

    console.log("[MemPalace preflight] ok", JSON.stringify({
      mode: result.mode,
      mempalaceStatus: result.mempalaceStatus,
      port: result.port,
      pid: result.pid,
      artifactPath,
    }));
    process.exitCode = 0;
  } catch (error) {
    const mode = getMode();
    const fallbackResult = {
      timestamp: new Date().toISOString(),
      mode,
      mempalaceStatus: "error",
      port: null,
      pid: null,
      healthCheck: {
        host: DEFAULT_HOST,
        port: null,
        reachable: false,
        detail: "preflight_exception",
      },
      errors: [error instanceof Error ? error.stack || error.message : String(error)],
      ok: mode === "relaxed",
    };
    const artifactPath = writeDebugArtifact(fallbackResult);

    if (mode === "relaxed") {
      console.warn("[MemPalace preflight] relaxed mode warning: preflight raised an exception; continuing.");
      console.warn(JSON.stringify({ ...fallbackResult, artifactPath }, null, 2));
      process.exitCode = 0;
      return;
    }

    console.error("[MemPalace preflight] strict mode exception.");
    console.error(JSON.stringify({ ...fallbackResult, artifactPath }, null, 2));
    process.exitCode = 1;
  }
}

main();