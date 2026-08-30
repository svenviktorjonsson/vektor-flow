import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';

import { writeFixture } from './materialize-fixture.mjs';
import { buildReadinessReceipt, canonicalTextSha256 } from './run.mjs';

const compiler = process.env.VKF_LAZY_DATA_COMPILER;
const configuredWorkRoot = resolve(
  process.env.VKF_TEST_WORK_ROOT ?? join(import.meta.dirname, '.work'),
);
const sourcePath = join(import.meta.dirname, 'programs', 'project-transform-reduce.vkf');
const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

test('VKF becomes AVAILABLE only after its public lazy CSV result matches the oracle', {
  skip: compiler ? false : 'VKF_LAZY_DATA_COMPILER is not configured',
}, () => {
  assert.equal(existsSync(compiler), true, 'configured VKF compiler does not exist');
  mkdirSync(configuredWorkRoot, { recursive: true });
  const work = mkdtempSync(join(configuredWorkRoot, 'i47-vkf-runner-'));
  try {
    const fixturePath = join(work, 'fixture.csv');
    const fixtureManifest = writeFixture(fixturePath, { rows: 128, rowsPerChunk: 17 });
    const receipt = buildReadinessReceipt({
      fixturePath,
      fixtureManifest,
      runners: { vkf: compiler },
      revision: 'i47-test-revision',
      workRoot: join(work, 'runner-work'),
    });

    assert.deepEqual(receipt.peers.vkf, {
      status: 'AVAILABLE',
      runner: resolve(compiler),
      runner_sha256: sha256(compiler),
      source_sha256: canonicalTextSha256(readFileSync(sourcePath, 'utf8')),
      result: fixtureManifest.expected_sum,
    });
    assert.equal(receipt.peers.vaex.status, 'UNAVAILABLE');
    assert.equal(receipt.peers.dask.status, 'UNAVAILABLE');
    assert.deepEqual(receipt.samples, []);
    assert.deepEqual(receipt.comparisons, []);

    const rejected = buildReadinessReceipt({
      fixturePath,
      fixtureManifest: { ...fixtureManifest, expected_sum: fixtureManifest.expected_sum + 1 },
      runners: { vkf: compiler },
      revision: 'i47-wrong-oracle',
      workRoot: join(work, 'wrong-oracle-work'),
    });
    assert.equal(rejected.peers.vkf.status, 'UNAVAILABLE');
    assert.match(rejected.peers.vkf.reason, /correctness oracle mismatch/);
    assert.equal(rejected.peers.vkf.runner_sha256, sha256(compiler));
    assert.equal(rejected.peers.vkf.source_sha256, canonicalTextSha256(readFileSync(sourcePath, 'utf8')));

    const cliFixture = join(work, 'cli-fixture.csv');
    const cliOutput = join(work, 'cli-readiness.json');
    const cli = spawnSync(process.execPath, [
      join(import.meta.dirname, 'run.mjs'),
      `--fixture=${cliFixture}`,
      '--rows=128',
      `--output=${cliOutput}`,
      '--revision=i47-cli-revision',
      `--vkf-runner=${compiler}`,
    ], { encoding: 'utf8', timeout: 60_000, windowsHide: true });
    assert.equal(cli.error, undefined, cli.error?.message);
    assert.equal(cli.status, 0, `${cli.stdout}\n${cli.stderr}`);
    const cliReceipt = JSON.parse(readFileSync(cliOutput, 'utf8'));
    assert.equal(cliReceipt.peers.vkf.status, 'AVAILABLE', JSON.stringify(cliReceipt.peers.vkf));
    assert.equal(cliReceipt.peers.vkf.result, fixtureManifest.expected_sum);
    assert.equal(cliReceipt.provenance.runner_sha256.vkf, sha256(compiler));
    assert.equal(cliReceipt.provenance.source_sha256, canonicalTextSha256(readFileSync(sourcePath, 'utf8')));
  } finally {
    rmSync(work, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
});
