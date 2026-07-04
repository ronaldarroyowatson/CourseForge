import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { bootstrapCourseForge } from '../../src/bootstrap/courseforge-bootstrap.js';
import { bootstrapOtto } from '../../src/bootstrap/otto-bootstrap.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const runtimeRoots: string[] = [];

afterEach(async () => {
  await Promise.all(runtimeRoots.splice(0).map((runtimeRoot) => rm(runtimeRoot, { recursive: true, force: true })));
});

describe('Otto to CourseForge tracer-bullet flow', () => {
  it('simulates opening the deployment package and completes the Otto + CourseForge startup sequence', async () => {
    const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), 'courseforge-integration-'));
    runtimeRoots.push(runtimeRoot);

    const otto = await bootstrapOtto({ repoRoot, runtimeRoot });

    expect(otto.actions.filter((action) => action.startsWith('downloaded:')).length).toBeGreaterThanOrEqual(8);
    expect(otto.readiness.commandServiceReady).toBe(true);
    expect(otto.readiness.loggingActive).toBe(true);
    expect(otto.readiness.tracingActive).toBe(true);
    expect(otto.readiness.metricsActive).toBe(true);
    expect(otto.updateStatus.restartRequired).toBe(true);
    expect(otto.updateStatus.restarted).toBe(true);

    const result = await bootstrapCourseForge({ repoRoot, runtimeRoot });

    expect(result.otto.updateStatus.state).toBe('up-to-date');
    expect(result.uiContext.ottoStatus).toBe('OK');
    expect(result.uiContext.extensionStatus.cli).toBe('OK');
    expect(result.uiContext.extensionStatus.api).toBe('OK');
    await access(result.uiFilePath);

    const renderedUi = await readFile(result.uiFilePath, 'utf8');
    expect(renderedUi).toContain('CourseForge Skeleton');
    expect(renderedUi).toContain('Otto: OK');
    expect(renderedUi).toContain('Logging: ON');
    expect(renderedUi).toContain('Tracing: ON');
    expect(renderedUi).toContain('Metrics: ON');
  });
});