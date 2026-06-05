import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("CLI auth and RBAC security", () => {
  let tempLocalAppData = "";

  beforeEach(() => {
    tempLocalAppData = fs.mkdtempSync(path.join(os.tmpdir(), "courseforge-cli-security-"));
  });

  afterEach(() => {
    fs.rmSync(tempLocalAppData, { recursive: true, force: true });
  });

  function runCli(argv: string[]) {
    return spawnSync(process.execPath, ["scripts/program-cli.mjs", ...argv], {
      cwd: process.cwd(),
      env: { ...process.env, LOCALAPPDATA: tempLocalAppData },
      encoding: "utf8",
    });
  }

  function parseStdoutJson(stdout: string) {
    return JSON.parse(String(stdout || "{}").trim());
  }

  it("supports login/logout/whoami/auth status/refresh/token-info", () => {
    const login = runCli(["login", "--role", "teacher", "--uid", "teacher-1", "--email", "teacher@school.test"]);
    expect(login.status).toBe(0);
    expect(parseStdoutJson(login.stdout)).toEqual(expect.objectContaining({
      commandId: "courseforge login",
      ok: true,
      role: "teacher",
      authenticated: true,
    }));

    const whoami = runCli(["whoami"]);
    expect(whoami.status).toBe(0);
    expect(parseStdoutJson(whoami.stdout)).toEqual(expect.objectContaining({
      commandId: "courseforge whoami",
      ok: true,
      role: "teacher",
      authenticated: true,
    }));

    const status = runCli(["auth", "status"]);
    expect(status.status).toBe(0);
    expect(parseStdoutJson(status.stdout)).toEqual(expect.objectContaining({
      commandId: "courseforge auth status",
      ok: true,
      role: "teacher",
      authenticated: true,
    }));

    const tokenInfo = runCli(["auth", "token-info"]);
    expect(tokenInfo.status).toBe(0);
    expect(parseStdoutJson(tokenInfo.stdout)).toEqual(expect.objectContaining({
      commandId: "courseforge auth token-info",
      ok: true,
      tokenState: "valid",
      authenticated: true,
    }));

    const refresh = runCli(["auth", "refresh", "--expiresInSeconds", "120"]);
    expect(refresh.status).toBe(0);
    expect(parseStdoutJson(refresh.stdout)).toEqual(expect.objectContaining({
      commandId: "courseforge auth refresh",
      ok: true,
      authenticated: true,
    }));

    const logout = runCli(["logout"]);
    expect(logout.status).toBe(0);
    expect(parseStdoutJson(logout.stdout)).toEqual(expect.objectContaining({
      commandId: "courseforge logout",
      ok: true,
      authenticated: false,
    }));
  });

  it("denies privileged commands for unauthenticated guests", () => {
    const deniedAdmin = runCli(["admin", "content", "search", "--collectionName", "textbooks"]);
    expect(deniedAdmin.status).toBe(1);
    expect(parseStdoutJson(deniedAdmin.stdout)).toEqual(expect.objectContaining({
      commandId: "courseforge security access denied",
      ok: false,
      reason: "not_authenticated",
    }));

    const deniedOcr = runCli(["ocr", "debug", "trace", "--json"]);
    expect(deniedOcr.status).toBe(1);
    expect(parseStdoutJson(deniedOcr.stdout)).toEqual(expect.objectContaining({
      commandId: "courseforge security access denied",
      ok: false,
      reason: "not_authenticated",
    }));
  });

  it("enforces role hierarchy for admin scopes", () => {
    const teacherLogin = runCli(["login", "--role", "teacher", "--uid", "teacher-2", "--email", "teacher2@school.test"]);
    expect(teacherLogin.status).toBe(0);

    const deniedSuper = runCli(["admin", "super", "dashboard", "refresh"]);
    expect(deniedSuper.status).toBe(1);
    expect(parseStdoutJson(deniedSuper.stdout)).toEqual(expect.objectContaining({
      commandId: "courseforge security access denied",
      ok: false,
      reason: "insufficient_role",
      requiredRole: "superAdmin",
      currentRole: "teacher",
    }));

    const superLogin = runCli(["login", "--role", "superAdmin", "--uid", "super-1", "--email", "super@district.test"]);
    expect(superLogin.status).toBe(0);

    const allowedSuper = runCli(["admin", "super", "dashboard", "refresh"]);
    expect(allowedSuper.status).toBe(0);
    expect(parseStdoutJson(allowedSuper.stdout)).toEqual(expect.objectContaining({
      commandId: "courseforge admin super dashboard refresh",
      ok: true,
    }));
  });

  it("rejects tampered or missing-token sessions", () => {
    const debugDir = path.join(tempLocalAppData, "CourseForge", "debug");
    fs.mkdirSync(debugDir, { recursive: true });
    fs.writeFileSync(path.join(debugDir, "auth-session.json"), JSON.stringify({
      uid: "tampered",
      role: "superAdmin",
      token: "",
      expiresAtMs: Date.now() + 60_000,
    }, null, 2), "utf8");

    const denied = runCli(["admin", "super", "dashboard", "refresh"]);
    expect(denied.status).toBe(1);
    expect(parseStdoutJson(denied.stdout)).toEqual(expect.objectContaining({
      commandId: "courseforge security access denied",
      ok: false,
      reason: "not_authenticated",
    }));
  });
});
