import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { bootstrapOtto } from '../otto-bootstrap.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const runtimeRoots: string[] = [];

afterEach(async () => {
  await Promise.all(runtimeRoots.splice(0).map((runtimeRoot) => rm(runtimeRoot, { recursive: true, force: true })));
});

describe('bootstrap.edgeCases', () => {
  it('becomes up-to-date on second bootstrap run in same runtime root', async () => {
    const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), 'otto-edge-'));
    runtimeRoots.push(runtimeRoot);

    await bootstrapOtto({ repoRoot, runtimeRoot });
    const second = await bootstrapOtto({ repoRoot, runtimeRoot });

    expect(second.updateStatus.ottoState).toBe('up-to-date');
  });
});
