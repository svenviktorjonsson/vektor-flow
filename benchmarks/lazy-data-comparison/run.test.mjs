import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { materializeFixture, writeFixture } from './materialize-fixture.mjs';
import {
  availabilityReport,
  buildReadinessReceipt,
  canonicalTextSha256,
  loadContract,
  validateCandidateSamples,
} from './run.mjs';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

test('text provenance hashes are stable across checkout line endings', () => {
  assert.equal(canonicalTextSha256('a\nb\n'), canonicalTextSha256('a\r\nb\r\n'));
});

test('streams a deterministic wide CSV with an independently computed exact oracle', () => {
  const first = materializeFixture({ rows: 4096 });
  const second = materializeFixture({ rows: 4096 });

  assert.deepEqual(first.manifest, second.manifest);
  assert.equal(sha256(first.bytes), first.manifest.sha256);
  assert.deepEqual(first.bytes, second.bytes);
  assert.equal(first.manifest.schema_version, 1);
  assert.equal(first.manifest.rows, 4096);
  assert.deepEqual(first.manifest.demanded_columns, ['x', 'y']);
  assert.ok(first.manifest.unused_columns.length >= 4);
  assert.ok(Number.isSafeInteger(first.manifest.expected_sum));

  const lines = first.bytes.toString('utf8').trimEnd().split('\n');
  assert.equal(lines.length, 4097);
  assert.equal(lines[0], ['row_id', 'x', 'y', ...first.manifest.unused_columns].join(','));

  let observed = 0;
  for (const line of lines.slice(1)) {
    const [, x, y] = line.split(',');
    observed += (2 * Number(x) - Number(y)) ** 2;
  }
  assert.equal(observed, first.manifest.expected_sum);
});

test('freezes non-gating correctness, cache, timing, sample, and provenance boundaries', () => {
  const contract = loadContract();

  assert.equal(contract.schema_version, 1);
  assert.equal(contract.status, 'non_gating');
  assert.equal(contract.correctness.kind, 'exact_f64_integer');
  assert.equal(contract.correctness.output, 'sum((2*x-y)^2)');
  assert.deepEqual(Object.keys(contract.boundaries), [
    'fresh_source_e2e',
    'warm_source_e2e',
  ]);
  assert.equal(contract.boundaries.fresh_source_e2e.os_cache, 'uncontrolled_reported');
  assert.equal(contract.boundaries.fresh_source_e2e.derived_cache, 'empty_per_sample');
  assert.equal(contract.boundaries.warm_source_e2e.process, 'fresh_per_sample');
  assert.equal(contract.boundaries.warm_source_e2e.derived_cache, 'retained');
  assert.equal(contract.measurement.outliers, 'retain_all');
  assert.equal(contract.measurement.order, 'paired_rotating_same_host');
  assert.ok(contract.measurement.required_raw_sample_fields.includes('elapsed_wall_ms'));
  assert.ok(contract.measurement.required_provenance_fields.includes('fixture_sha256'));
  assert.equal(contract.peer_set.status, 'unfrozen_dependencies');
  assert.deepEqual(contract.peer_set.members, ['vkf', 'vaex', 'dask']);
});

test('reports every absent peer as UNAVAILABLE without fallback or timing claims', () => {
  const report = availabilityReport({});

  assert.equal(report.schema_version, 1);
  assert.equal(report.status, 'not_measured');
  assert.equal(report.non_gating, true);
  assert.deepEqual(report.samples, []);
  assert.deepEqual(report.comparisons, []);
  for (const peer of ['vkf', 'vaex', 'dask']) {
    assert.deepEqual(report.peers[peer], {
      status: 'UNAVAILABLE',
      reason: 'runner not provided',
    });
  }
  assert.equal(JSON.stringify(report).includes('fallback'), false);
});

test('binds an available runner by hash and reports a missing path as UNAVAILABLE', () => {
  const work = mkdtempSync(join(tmpdir(), 'vkf-lazy-runner-'));
  try {
    const runner = join(work, 'runner');
    writeFileSync(runner, 'candidate runner bytes', 'utf8');
    const report = availabilityReport({
      vkf: runner,
      vaex: join(work, 'missing-runner'),
    });

    assert.deepEqual(report.peers.vkf, {
      status: 'AVAILABLE',
      runner,
      runner_sha256: sha256(readFileSync(runner)),
    });
    assert.deepEqual(report.peers.vaex, {
      status: 'UNAVAILABLE',
      reason: 'runner path does not exist',
    });
    assert.deepEqual(report.peers.dask, {
      status: 'UNAVAILABLE',
      reason: 'runner not provided',
    });
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test('readiness follows the versioned peer manifest instead of a fixed implementation list', () => {
  const contract = { peer_set: { members: ['vkf', 'polars'] } };
  const report = availabilityReport({}, contract);
  assert.deepEqual(Object.keys(report.peers), ['vkf', 'polars']);
  assert.equal(report.peers.polars.status, 'UNAVAILABLE');
});

test('accepts only exact, complete raw samples before any comparison is possible', () => {
  const contract = loadContract();
  const manifest = materializeFixture({ rows: 16 }).manifest;
  const sample = {
    peer: 'vkf',
    boundary: 'fresh_source_e2e',
    round: 0,
    order: 0,
    elapsed_wall_ms: 12.5,
    result: manifest.expected_sum,
    status: 'OK',
  };

  assert.deepEqual(validateCandidateSamples([sample], manifest, contract), [sample]);
  assert.throws(
    () => validateCandidateSamples([{ ...sample, result: sample.result + 1 }], manifest, contract),
    /result mismatch/,
  );
  const { elapsed_wall_ms: ignored, ...missingElapsed } = sample;
  assert.throws(
    () => validateCandidateSamples([missingElapsed], manifest, contract),
    /missing raw sample field elapsed_wall_ms/,
  );
  assert.throws(
    () => validateCandidateSamples([{ ...sample, elapsed_wall_ms: -1 }], manifest, contract),
    /invalid elapsed_wall_ms/,
  );
});

test('readiness receipt binds fixture, contract, and VKF source hashes before measurement', () => {
  const work = mkdtempSync(join(tmpdir(), 'vkf-lazy-benchmark-'));
  try {
    const fixturePath = join(work, 'fixture.csv');
    const manifest = writeFixture(fixturePath, { rows: 32, rowsPerChunk: 7 });
    const receipt = buildReadinessReceipt({
      fixturePath,
      fixtureManifest: manifest,
      runners: {},
      revision: 'test-revision',
    });

    assert.equal(receipt.status, 'not_measured');
    assert.equal(receipt.non_gating, true);
    assert.equal(receipt.provenance.revision, 'test-revision');
    assert.equal(receipt.provenance.fixture_sha256, manifest.sha256);
    assert.match(receipt.provenance.contract_sha256, /^[0-9a-f]{64}$/);
    assert.match(receipt.provenance.source_sha256, /^[0-9a-f]{64}$/);
    assert.deepEqual(receipt.provenance.runner_sha256, {
      vkf: null,
      vaex: null,
      dask: null,
    });
    assert.deepEqual(receipt.samples, []);
    assert.deepEqual(receipt.comparisons, []);

    writeFileSync(fixturePath, `${readFileSync(fixturePath, 'utf8')}0,0,0\n`, 'utf8');
    assert.throws(
      () => buildReadinessReceipt({
        fixturePath,
        fixtureManifest: manifest,
        runners: {},
        revision: 'test-revision',
      }),
      /fixture SHA-256 changed/,
    );
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test('CLI emits a deterministic readiness receipt and never substitutes missing peers', () => {
  const work = mkdtempSync(join(tmpdir(), 'vkf-lazy-benchmark-cli-'));
  try {
    const fixturePath = join(work, 'fixture.csv');
    const outputPath = join(work, 'readiness.json');
    const result = spawnSync(process.execPath, [
      fileURLToPath(new URL('./run.mjs', import.meta.url)),
      `--fixture=${fixturePath}`,
      '--rows=64',
      `--output=${outputPath}`,
      '--revision=test-cli-revision',
    ], { encoding: 'utf8', windowsHide: true });

    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.status, 0, result.stderr);
    const receipt = JSON.parse(readFileSync(outputPath, 'utf8'));
    assert.equal(receipt.status, 'not_measured');
    assert.equal(receipt.fixture.rows, 64);
    assert.equal(receipt.provenance.revision, 'test-cli-revision');
    assert.deepEqual(
      Object.fromEntries(Object.entries(receipt.peers).map(([peer, value]) => [peer, value.status])),
      { vkf: 'UNAVAILABLE', vaex: 'UNAVAILABLE', dask: 'UNAVAILABLE' },
    );
    assert.deepEqual(receipt.samples, []);
    assert.deepEqual(receipt.comparisons, []);
    assert.equal(result.stdout.trim(), outputPath);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test('CLI rejects a readiness receipt without revision provenance', () => {
  const work = mkdtempSync(join(tmpdir(), 'vkf-lazy-benchmark-no-revision-'));
  try {
    const result = spawnSync(process.execPath, [
      fileURLToPath(new URL('./run.mjs', import.meta.url)),
      `--fixture=${join(work, 'fixture.csv')}`,
      `--output=${join(work, 'readiness.json')}`,
    ], { encoding: 'utf8', windowsHide: true });
    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /--revision is required/);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
