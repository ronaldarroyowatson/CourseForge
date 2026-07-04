import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { bootstrapCourseForge } from '../src/bootstrap/courseforge-bootstrap.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runtimeRoots: string[] = [];

afterEach(async () => {
  await Promise.all(runtimeRoots.splice(0).map((runtimeRoot) => rm(runtimeRoot, { recursive: true, force: true })));
});

describe('CourseForge bootstrap', () => {
  it('starts Otto before rendering the CourseForge skeleton UI', async () => {
    const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), 'courseforge-basic-'));
    runtimeRoots.push(runtimeRoot);

    const result = await bootstrapCourseForge({ repoRoot, runtimeRoot });

    expect(result.otto.readiness.running).toBe(true);
    expect(result.otto.readiness.kernelLoaded).toBe(true);
    expect(result.otto.readiness.cliExtensionLoaded).toBe(true);
    expect(result.otto.readiness.apiExtensionLoaded).toBe(true);
    expect(result.uiContext.ottoStatus).toBe('OK');
    expect(result.uiContext.courseForgeStatus).toBe('LOADED');
    expect(result.ui.html).toContain('CourseForge Skeleton');
    expect(result.ui.html).toContain('Otto: OK');
    expect(result.ui.html).toContain('CLI: OK');
    expect(result.ui.html).toContain('API: OK');
  });
});