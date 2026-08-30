import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';

import { writeFixture } from './materialize-fixture.mjs';
import {
  buildReadinessReceipt,
  canonicalTextSha256,
  verifyPolarsRunner,
} from './run.mjs';

const python = process.env.VKF_POLARS_PYTHON;
const configuredWorkRoot = resolve(
  process.env.VKF_TEST_WORK_ROOT ?? join(import.meta.dirname, '.work'),
);
const sourcePath = join(import.meta.dirname, 'programs', 'project-transform-reduce-polars.py');
const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

test('Polars is AVAILABLE only after its public lazy result matches the exact oracle', {
  skip: python ? false : 'VKF_POLARS_PYTHON is not configured',
}, () => {
  assert.equal(existsSync(python), true, 'configured Polars Python does not exist');
  mkdirSync(configuredWorkRoot, { recursive: true });
  const work = mkdtempSync(join(configuredWorkRoot, 'i49-polars-runner-'));
  try {
    const fixturePath = join(work, 'fixture.csv');
    const fixtureManifest = writeFixture(fixturePath, { rows: 128, rowsPerChunk: 17 });
    const receipt = buildReadinessReceipt({
      fixturePath,
      fixtureManifest,
      runners: { polars: python },
      revision: 'i49-test-revision',
      workRoot: join(work, 'runner-work'),
    });

    assert.equal(receipt.peers.polars.status, 'AVAILABLE');
    assert.equal(receipt.peers.polars.runner, resolve(python));
    assert.equal(receipt.peers.polars.runner_sha256, sha256(python));
    assert.equal(
      receipt.peers.polars.source_sha256,
      canonicalTextSha256(readFileSync(sourcePath, 'utf8')),
    );
    assert.equal(receipt.peers.polars.peer_version, '1.44.1');
    assert.match(receipt.peers.polars.dependency_sha256, /^[0-9a-f]{64}$/);
    assert.equal(receipt.peers.polars.threads, 1);
    assert.equal(receipt.peers.polars.result, fixtureManifest.expected_sum);
    assert.deepEqual(receipt.samples, []);
    assert.deepEqual(receipt.comparisons, []);

    const rejected = buildReadinessReceipt({
      fixturePath,
      fixtureManifest: { ...fixtureManifest, expected_sum: fixtureManifest.expected_sum + 1 },
      runners: { polars: python },
      revision: 'i49-wrong-oracle',
      workRoot: join(work, 'wrong-oracle-work'),
    });
    assert.equal(rejected.peers.polars.status, 'UNAVAILABLE');
    assert.match(rejected.peers.polars.reason, /correctness oracle mismatch/);
    assert.equal(rejected.peers.polars.peer_version, '1.44.1');
    assert.equal(rejected.peers.polars.dependency_sha256, receipt.peers.polars.dependency_sha256);

    const missing = buildReadinessReceipt({
      fixturePath,
      fixtureManifest,
      runners: { polars: join(work, 'missing-python') },
      revision: 'i49-missing-dependency',
    });
    assert.deepEqual(missing.peers.polars, {
      status: 'UNAVAILABLE',
      reason: 'runner path does not exist',
    });

    const incompatible = verifyPolarsRunner({
      runner: python,
      fixturePath,
      fixtureManifest,
      requirement: { distribution: 'polars', version: '0.0.0' },
      threads: 1,
    });
    assert.equal(incompatible.status, 'UNAVAILABLE');
    assert.match(incompatible.reason, /incompatible Polars version: 1\.44\.1/);

    const cliFixture = join(work, 'cli-fixture.csv');
    const cliOutput = join(work, 'cli-readiness.json');
    const cli = spawnSync(process.execPath, [
      join(import.meta.dirname, 'run.mjs'),
      `--fixture=${cliFixture}`,
      '--rows=128',
      `--output=${cliOutput}`,
      '--revision=i49-cli-revision',
      `--polars-runner=${python}`,
    ], { encoding: 'utf8', timeout: 60_000, windowsHide: true });
    assert.equal(cli.error, undefined, cli.error?.message);
    assert.equal(cli.status, 0, `${cli.stdout}\n${cli.stderr}`);
    const cliReceipt = JSON.parse(readFileSync(cliOutput, 'utf8'));
    assert.equal(cliReceipt.peers.polars.status, 'AVAILABLE');
    assert.equal(cliReceipt.peers.polars.result, fixtureManifest.expected_sum);
    assert.equal(cliReceipt.peers.polars.peer_version, '1.44.1');
    assert.equal(cliReceipt.peers.polars.threads, 1);
  } finally {
    rmSync(work, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
});
