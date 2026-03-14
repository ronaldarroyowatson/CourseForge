import { spawnSync } from "node:child_process";
import path from "node:path";

function runNodeScript(args: string[]): number {
  const result = spawnSync(process.execPath, args, {
    stdio: "inherit",
  });

  if (result.error) {
    throw result.error;
  }

  return result.status ?? 1;
}

function runFirebaseEmulatorScript(args: string[]): number {
  const result = spawnSync(process.execPath, args, {
    encoding: "utf8",
    stdio: "pipe",
  });

  if (result.stdout) {
    process.stdout.write(result.stdout);
  }

  if (result.stderr) {
    process.stderr.write(result.stderr);
  }

  if (result.error) {
    throw result.error;
  }

  const status = result.status ?? 1;
  if (status === 0) {
    return 0;
  }

  const combinedOutput = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  const scriptSucceeded = combinedOutput.includes("Script exited successfully (code 0)");

  // firebase-tools can occasionally return a non-zero code after successful
  // emulator script execution due a shutdown race. Preserve real test failures.
  if (scriptSucceeded) {
    return 0;
  }

  return status;
}

function hasJavaRuntime(): boolean {
  const result = spawnSync("java", ["-version"], {
    stdio: "ignore",
  });

  return !result.error && result.status === 0;
}

const workspaceRoot = process.cwd();
const firebaseCliPath = path.resolve(workspaceRoot, "node_modules", "firebase-tools", "lib", "bin", "firebase.js");
const vitestCliPath = path.resolve(workspaceRoot, "node_modules", "vitest", "vitest.mjs");

const emulatorTestCommand = `\"${process.execPath}\" \"${vitestCliPath}\" run tests/rules/firestore.rules.test.ts --passWithNoTests`;

if (hasJavaRuntime()) {
  const status = runFirebaseEmulatorScript([
    firebaseCliPath,
    "emulators:exec",
    "--only",
    "firestore",
    emulatorTestCommand,
  ]);

  process.exit(status);
}

// Deterministic fallback path when Java is unavailable in the local environment.
const fallbackStatus = runNodeScript([
  vitestCliPath,
  "run",
  "tests/rules/firestore.rules.contract.static.test.ts",
  "--passWithNoTests",
]);

process.exit(fallbackStatus);
