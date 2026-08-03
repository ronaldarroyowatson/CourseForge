import { mkdtemp, readFile, rm } from 'node:fs/promises';
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

  it('detects a newer release version when the resolver advances', async () => {
    const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), 'otto-release-'));
    runtimeRoots.push(runtimeRoot);

    const first = await bootstrapOtto({
      repoRoot,
      runtimeRoot,
      resolveReleaseVersion: async (component) => (component.name === 'otto-core' ? '1.0.0' : null)
    });

    expect(first.updateStatus.appliedOttoComponents).toContain('otto-core');

    const second = await bootstrapOtto({
      repoRoot,
      runtimeRoot,
      resolveReleaseVersion: async (component) => (component.name === 'otto-core' ? '1.0.1' : null)
    });

    expect(second.updateStatus.appliedOttoComponents).toContain('otto-core');

    const receiptPath = path.join(runtimeRoot, 'components', 'otto', 'otto-core.json');
    const receipt = JSON.parse(await readFile(receiptPath, 'utf8')) as { version: string; resolvedVersionSource?: string };

    expect(receipt.version).toBe('1.0.1');
    expect(receipt.resolvedVersionSource).toBe('release-metadata');
  });

  it('reinstalls component when install directory metadata is missing but top-level receipt exists', async () => {
    const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), 'otto-recovery-metadata-'));
    runtimeRoots.push(runtimeRoot);

    await bootstrapOtto({ repoRoot, runtimeRoot });

    const installReceiptPath = path.join(runtimeRoot, 'components', 'otto', 'otto-kernel', 'receipt.json');
    await rm(installReceiptPath, { force: true });

    const second = await bootstrapOtto({ repoRoot, runtimeRoot });
    expect(second.updateStatus.appliedOttoComponents).toContain('otto-kernel');
  });

  it('reinstalls component when install directory is missing after broken uninstall', async () => {
    const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), 'otto-recovery-uninstall-'));
    runtimeRoots.push(runtimeRoot);

    await bootstrapOtto({ repoRoot, runtimeRoot });

    const installDirectory = path.join(runtimeRoot, 'components', 'courseforge', 'courseforge-core-shell');
    await rm(installDirectory, { recursive: true, force: true });

    const second = await bootstrapOtto({ repoRoot, runtimeRoot });
    expect(second.updateStatus.appliedCourseForgeComponents).toContain('courseforge-core-shell');
  });
});
