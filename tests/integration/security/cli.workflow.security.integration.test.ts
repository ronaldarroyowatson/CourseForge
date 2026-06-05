import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("CLI integration security workflows", () => {
  let tempLocalAppData = "";

  beforeEach(() => {
    tempLocalAppData = fs.mkdtempSync(path.join(os.tmpdir(), "courseforge-cli-security-integration-"));
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

  function parse(stdout: string) {
    return JSON.parse(String(stdout || "{}").trim());
  }

  it("district admin can run district commands but not super-admin commands", () => {
    const login = runCli(["login", "--role", "districtAdmin", "--uid", "district-1", "--email", "district@courseforge.test"]);
    expect(login.status).toBe(0);

    const districtAllowed = runCli(["admin", "content", "search", "--collectionName", "textbooks"]);
    expect(districtAllowed.status).toBe(0);
    expect(parse(districtAllowed.stdout)).toEqual(expect.objectContaining({
      commandId: "courseforge admin content search",
      ok: true,
    }));

    const superDenied = runCli(["admin", "super", "user", "admin", "toggle", "--uid", "u-1", "--isAdmin", "true"]);
    expect(superDenied.status).toBe(1);
    expect(parse(superDenied.stdout)).toEqual(expect.objectContaining({
      commandId: "courseforge security access denied",
      ok: false,
      requiredRole: "superAdmin",
      currentRole: "districtAdmin",
    }));
  });

  it("school admin can run school commands but not district-level admin commands", () => {
    const login = runCli(["login", "--role", "schoolAdmin", "--uid", "school-1", "--email", "school@courseforge.test"]);
    expect(login.status).toBe(0);

    const schoolAllowed = runCli(["admin", "school", "invite", "--schoolId", "school-1", "--inviteEmail", "teacher@school.test"]);
    expect(schoolAllowed.status).toBe(0);
    expect(parse(schoolAllowed.stdout)).toEqual(expect.objectContaining({
      commandId: "courseforge admin school invite",
      ok: true,
    }));

    const districtDenied = runCli(["admin", "content", "search", "--collectionName", "textbooks"]);
    expect(districtDenied.status).toBe(1);
    expect(parse(districtDenied.stdout)).toEqual(expect.objectContaining({
      commandId: "courseforge security access denied",
      ok: false,
      requiredRole: "districtAdmin",
      currentRole: "schoolAdmin",
    }));
  });
});
