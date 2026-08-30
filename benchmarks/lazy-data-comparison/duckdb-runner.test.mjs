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
  verifyDuckdbRunner,
} from './run.mjs';

const python = process.env.VKF_DUCKDB_PYTHON;
const configuredWorkRoot = resolve(
  process.env.VKF_TEST_WORK_ROOT ?? join(import.meta.dirname, '.work'),
);
const sourcePath = join(import.meta.dirname, 'programs', 'project-transform-reduce-duckdb.py');
const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

test('DuckDB is AVAILABLE only after its public CSV query matches the exact oracle', {
  skip: python ? false : 'VKF_DUCKDB_PYTHON is not configured',
}, () => {
  assert.equal(existsSync(python), true, 'configured DuckDB Python does not exist');
  mkdirSync(configuredWorkRoot, { recursive: true });
  const work = mkdtempSync(join(configuredWorkRoot, 'i50-duckdb-runner-'));
  try {
    const fixturePath = join(work, 'fixture.csv');
    const fixtureManifest = writeFixture(fixturePath, { rows: 128, rowsPerChunk: 17 });
    const receipt = buildReadinessReceipt({
      fixturePath,
      fixtureManifest,
      runners: { duckdb: python },
      revision: 'i50-test-revision',
      workRoot: join(work, 'runner-work'),
    });

    assert.equal(receipt.peers.duckdb.status, 'AVAILABLE');
    assert.equal(receipt.peers.duckdb.runner, resolve(python));
    assert.equal(receipt.peers.duckdb.runner_sha256, sha256(python));
    assert.equal(
      receipt.peers.duckdb.source_sha256,
      canonicalTextSha256(readFileSync(sourcePath, 'utf8')),
    );
    assert.equal(receipt.peers.duckdb.peer_version, '1.5.5');
    assert.match(receipt.peers.duckdb.distribution_sha256, /^[0-9a-f]{64}$/);
    assert.equal(receipt.peers.duckdb.threads, 1);
    assert.deepEqual(receipt.peers.duckdb.projected_columns, ['x', 'y']);
    assert.equal(receipt.peers.duckdb.result, fixtureManifest.expected_sum);
    assert.deepEqual(receipt.samples, []);
    assert.deepEqual(receipt.comparisons, []);

    const rejected = buildReadinessReceipt({
      fixturePath,
      fixtureManifest: { ...fixtureManifest, expected_sum: fixtureManifest.expected_sum + 1 },
      runners: { duckdb: python },
      revision: 'i50-wrong-oracle',
      workRoot: join(work, 'wrong-oracle-work'),
    });
    assert.equal(rejected.peers.duckdb.status, 'UNAVAILABLE');
    assert.match(rejected.peers.duckdb.reason, /correctness oracle mismatch/);
    assert.equal(rejected.peers.duckdb.peer_version, '1.5.5');
    assert.equal(
      rejected.peers.duckdb.distribution_sha256,
      receipt.peers.duckdb.distribution_sha256,
    );

    const missing = buildReadinessReceipt({
      fixturePath,
      fixtureManifest,
      runners: { duckdb: join(work, 'missing-python') },
      revision: 'i50-missing-dependency',
    });
    assert.deepEqual(missing.peers.duckdb, {
      status: 'UNAVAILABLE',
      reason: 'runner path does not exist',
    });

    const incompatible = verifyDuckdbRunner({
      runner: python,
      fixturePath,
      fixtureManifest,
      requirement: { distribution: 'duckdb', version: '0.0.0' },
      threads: 1,
    });
    assert.equal(incompatible.status, 'UNAVAILABLE');
    assert.match(incompatible.reason, /incompatible DuckDB version: 1\.5\.5/);

    const cliFixture = join(work, 'cli-fixture.csv');
    const cliOutput = join(work, 'cli-readiness.json');
    const cli = spawnSync(process.execPath, [
      join(import.meta.dirname, 'run.mjs'),
      `--fixture=${cliFixture}`,
      '--rows=128',
      `--output=${cliOutput}`,
      '--revision=i50-cli-revision',
      `--duckdb-runner=${python}`,
    ], { encoding: 'utf8', timeout: 60_000, windowsHide: true });
    assert.equal(cli.error, undefined, cli.error?.message);
    assert.equal(cli.status, 0, `${cli.stdout}\n${cli.stderr}`);
    const cliReceipt = JSON.parse(readFileSync(cliOutput, 'utf8'));
    assert.equal(cliReceipt.peers.duckdb.status, 'AVAILABLE');
    assert.equal(cliReceipt.peers.duckdb.result, fixtureManifest.expected_sum);
    assert.equal(cliReceipt.peers.duckdb.peer_version, '1.5.5');
    assert.equal(cliReceipt.peers.duckdb.threads, 1);
    assert.deepEqual(cliReceipt.peers.duckdb.projected_columns, ['x', 'y']);
  } finally {
    rmSync(work, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
});
