import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

async function loginAs(env: NodeJS.ProcessEnv, role = "superAdmin") {
  await execFileAsync(process.execPath, [
    "scripts/program-cli.mjs",
    "login",
    "--role",
    role,
    "--uid",
    `test-${role}-uid`,
    "--email",
    `${role}@courseforge.test`,
  ], {
    cwd: process.cwd(),
    env,
  });
}

describe("program CLI workflow parity command groups", () => {
  let tempLocalAppData = "";

  beforeEach(() => {
    tempLocalAppData = fs.mkdtempSync(path.join(os.tmpdir(), "courseforge-workflow-parity-"));
  });

  afterEach(() => {
    fs.rmSync(tempLocalAppData, { recursive: true, force: true });
  });

  it("includes textbooks/admin/settings in help output", async () => {
    const env = {
      ...process.env,
      LOCALAPPDATA: tempLocalAppData,
    };

    const result = await execFileAsync(process.execPath, ["scripts/program-cli.mjs", "help"], {
      cwd: process.cwd(),
      env,
    });

    expect(result.stdout).toContain("  - textbooks");
    expect(result.stdout).toContain("  - admin");
    expect(result.stdout).toContain("  - settings");
  });

  it("accepts textbooks workflow commands", async () => {
    const env = {
      ...process.env,
      LOCALAPPDATA: tempLocalAppData,
    };

    await loginAs(env, "teacher");

    const result = await execFileAsync(process.execPath, [
      "scripts/program-cli.mjs",
      "textbooks",
      "save",
      "--title",
      "Biology",
      "--isbn",
      "9780134685991",
      "--sourceType",
      "manual",
    ], {
      cwd: process.cwd(),
      env,
    });

    const parsed = JSON.parse(result.stdout);
    expect(parsed).toEqual(expect.objectContaining({
      commandId: "courseforge textbooks save",
      ok: true,
      title: "Biology",
      isbn: "9780134685991",
      sourceType: "manual",
    }));

    const retrySync = await execFileAsync(process.execPath, [
      "scripts/program-cli.mjs",
      "textbooks",
      "sync",
      "retry",
      "--textbookId",
      "textbook-123",
    ], {
      cwd: process.cwd(),
      env,
    });

    const retryParsed = JSON.parse(retrySync.stdout);
    expect(retryParsed).toEqual(expect.objectContaining({
      commandId: "courseforge textbooks sync retry",
      ok: true,
      textbookId: "textbook-123",
    }));

    const autoCapture = await execFileAsync(process.execPath, [
      "scripts/program-cli.mjs",
      "textbooks",
      "auto",
      "capture",
      "toc",
      "--step",
      "toc",
    ], {
      cwd: process.cwd(),
      env,
    });

    const autoParsed = JSON.parse(autoCapture.stdout);
    expect(autoParsed).toEqual(expect.objectContaining({
      commandId: "courseforge textbooks auto capture toc",
      ok: true,
      step: "toc",
    }));
  });

  it("accepts admin and settings workflow commands", async () => {
    const env = {
      ...process.env,
      LOCALAPPDATA: tempLocalAppData,
    };

    await loginAs(env, "superAdmin");

    const adminResult = await execFileAsync(process.execPath, [
      "scripts/program-cli.mjs",
      "admin",
      "content",
      "search",
      "--collectionName",
      "textbooks",
      "--title",
      "Biology",
    ], {
      cwd: process.cwd(),
      env,
    });

    const adminParsed = JSON.parse(adminResult.stdout);
    expect(adminParsed).toEqual(expect.objectContaining({
      commandId: "courseforge admin content search",
      ok: true,
      collectionName: "textbooks",
      filterTitle: "Biology",
    }));

    const settingsResult = await execFileAsync(process.execPath, [
      "scripts/program-cli.mjs",
      "settings",
      "language",
      "set",
      "--language",
      "es",
    ], {
      cwd: process.cwd(),
      env,
    });

    const settingsParsed = JSON.parse(settingsResult.stdout);
    expect(settingsParsed).toEqual(expect.objectContaining({
      commandId: "courseforge settings language set",
      ok: true,
      language: "es",
    }));

    const correctionsResult = await execFileAsync(process.execPath, [
      "scripts/program-cli.mjs",
      "admin",
      "corrections",
      "review",
      "single",
      "--recordId",
      "corr-1",
    ], {
      cwd: process.cwd(),
      env,
    });

    const correctionsParsed = JSON.parse(correctionsResult.stdout);
    expect(correctionsParsed).toEqual(expect.objectContaining({
      commandId: "courseforge admin corrections review single",
      ok: true,
      recordId: "corr-1",
    }));

    const translationResult = await execFileAsync(process.execPath, [
      "scripts/program-cli.mjs",
      "admin",
      "translations",
      "review",
      "approve",
      "--language",
      "es",
      "--termId",
      "mitosis",
    ], {
      cwd: process.cwd(),
      env,
    });

    const translationParsed = JSON.parse(translationResult.stdout);
    expect(translationParsed).toEqual(expect.objectContaining({
      commandId: "courseforge admin translations review approve",
      ok: true,
      language: "es",
      termId: "mitosis",
    }));

    const schoolResult = await execFileAsync(process.execPath, [
      "scripts/program-cli.mjs",
      "admin",
      "school",
      "invite",
      "--schoolId",
      "school-1",
      "--inviteEmail",
      "teacher@school.edu",
    ], {
      cwd: process.cwd(),
      env,
    });

    const schoolParsed = JSON.parse(schoolResult.stdout);
    expect(schoolParsed).toEqual(expect.objectContaining({
      commandId: "courseforge admin school invite",
      ok: true,
      schoolId: "school-1",
      inviteEmail: "teacher@school.edu",
    }));

    const superResult = await execFileAsync(process.execPath, [
      "scripts/program-cli.mjs",
      "admin",
      "super",
      "user",
      "admin",
      "toggle",
      "--uid",
      "user-1",
      "--isAdmin",
      "true",
    ], {
      cwd: process.cwd(),
      env,
    });

    const superParsed = JSON.parse(superResult.stdout);
    expect(superParsed).toEqual(expect.objectContaining({
      commandId: "courseforge admin super user admin toggle",
      ok: true,
      uid: "user-1",
      isAdmin: "true",
    }));

    const usersResult = await execFileAsync(process.execPath, [
      "scripts/program-cli.mjs",
      "admin",
      "users",
      "content",
      "block",
      "toggle",
      "--uid",
      "user-2",
      "--isContentBlocked",
      "true",
    ], {
      cwd: process.cwd(),
      env,
    });

    const usersParsed = JSON.parse(usersResult.stdout);
    expect(usersParsed).toEqual(expect.objectContaining({
      commandId: "courseforge admin users content block toggle",
      ok: true,
      uid: "user-2",
      isContentBlocked: "true",
    }));

    const settingsPluginResult = await execFileAsync(process.execPath, [
      "scripts/program-cli.mjs",
      "settings",
      "plugin",
      "dsc",
      "install",
    ], {
      cwd: process.cwd(),
      env,
    });

    const settingsPluginParsed = JSON.parse(settingsPluginResult.stdout);
    expect(settingsPluginParsed).toEqual(expect.objectContaining({
      commandId: "courseforge settings plugin dsc install",
      ok: true,
    }));

    const settingsUpdaterResult = await execFileAsync(process.execPath, [
      "scripts/program-cli.mjs",
      "settings",
      "updater",
      "check",
    ], {
      cwd: process.cwd(),
      env,
    });

    const settingsUpdaterParsed = JSON.parse(settingsUpdaterResult.stdout);
    expect(settingsUpdaterParsed).toEqual(expect.objectContaining({
      commandId: "courseforge settings updater check",
      ok: true,
    }));

    const settingsDesignResult = await execFileAsync(process.execPath, [
      "scripts/program-cli.mjs",
      "settings",
      "design",
      "cloud",
      "decision",
      "apply-cloud",
    ], {
      cwd: process.cwd(),
      env,
    });

    const settingsDesignParsed = JSON.parse(settingsDesignResult.stdout);
    expect(settingsDesignParsed).toEqual(expect.objectContaining({
      commandId: "courseforge settings design cloud decision apply-cloud",
      ok: true,
    }));

    const settingsMetadataResult = await execFileAsync(process.execPath, [
      "scripts/program-cli.mjs",
      "settings",
      "metadata",
      "sharing",
      "toggle",
      "--enabled",
      "true",
    ], {
      cwd: process.cwd(),
      env,
    });

    const settingsMetadataParsed = JSON.parse(settingsMetadataResult.stdout);
    expect(settingsMetadataParsed).toEqual(expect.objectContaining({
      commandId: "courseforge settings metadata sharing toggle",
      ok: true,
      enabled: "true",
    }));

    const translationMemoryResult = await execFileAsync(process.execPath, [
      "scripts/program-cli.mjs",
      "admin",
      "translations",
      "memory",
      "override",
      "--language",
      "es",
      "--termId",
      "mitosis",
    ], {
      cwd: process.cwd(),
      env,
    });

    const translationMemoryParsed = JSON.parse(translationMemoryResult.stdout);
    expect(translationMemoryParsed).toEqual(expect.objectContaining({
      commandId: "courseforge admin translations memory override",
      ok: true,
      language: "es",
      termId: "mitosis",
    }));

    const glossaryResult = await execFileAsync(process.execPath, [
      "scripts/program-cli.mjs",
      "admin",
      "glossary",
      "save",
      "--subject",
      "biology",
      "--sourceLanguage",
      "en",
      "--targetLanguage",
      "es",
    ], {
      cwd: process.cwd(),
      env,
    });

    const glossaryParsed = JSON.parse(glossaryResult.stdout);
    expect(glossaryParsed).toEqual(expect.objectContaining({
      commandId: "courseforge admin glossary save",
      ok: true,
      subject: "biology",
      sourceLanguage: "en",
      targetLanguage: "es",
    }));
  });
});
