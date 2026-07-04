import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { bootstrapCourseForge } from '../courseforge-bootstrap.js';
import { bootstrapOtto } from '../otto-bootstrap.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const runtimeRoots: string[] = [];

afterEach(async () => {
  await Promise.all(runtimeRoots.splice(0).map((runtimeRoot) => rm(runtimeRoot, { recursive: true, force: true })));
});

describe('bootstrap.basic', () => {
  it('boots otto runtime in courseforge mode', async () => {
    const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), 'otto-basic-'));
    runtimeRoots.push(runtimeRoot);

    const otto = await bootstrapOtto({ repoRoot, runtimeRoot });
    expect(otto.mode).toBe('courseforge');
  });

  it('renders courseforge cloud ui after bootstrap', async () => {
    const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), 'courseforge-basic-'));
    runtimeRoots.push(runtimeRoot);

    const result = await bootstrapCourseForge({ repoRoot, runtimeRoot });
    expect(result.ui.html.includes('CourseForge Cloud UI')).toBe(true);
  });
});
