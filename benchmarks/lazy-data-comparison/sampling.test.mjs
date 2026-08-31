import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { writeFixture } from './materialize-fixture.mjs';
import { buildSamplingReceipt, collectPairedSamples, runSampleProcess } from './run.mjs';

const publicRunners = Object.freeze({
  vkf: process.env.VKF_LAZY_DATA_COMPILER,
  polars: process.env.VKF_POLARS_PYTHON,
  duckdb: process.env.VKF_DUCKDB_PYTHON,
});

test('captures wall time after process status and exact oracle validation', () => {
  const cases = [
    { name: 'timeout', executed: { error: { code: 'ETIMEDOUT' }, status: null, stdout: '' }, expected: 'TIMEOUT' },
    { name: 'error', executed: { error: null, status: 7, stdout: '' }, expected: 'ERROR' },
    { name: 'mismatch', executed: { error: null, status: 0, stdout: '43\n' }, expected: 'ORACLE_MISMATCH' },
    { name: 'ok', executed: { error: null, status: 0, stdout: '42\n' }, expected: 'OK' },
  ];
  for (const { name, executed, expected } of cases) {
    const observations = [];
    const observedExecution = new Proxy(executed, {
      get(target, property) {
        observations.push(String(property));
        return target[property];
      },
    });
    let clockReads = 0;
    const observed = runSampleProcess({
      specification: { command: 'unused' },
      boundary: 'fresh_source_e2e',
      phase: 'sample',
      cwd: '.',
      timeoutMs: 1_000,
      expected: 42,
      spawnProcess() { return observedExecution; },
      now() {
        clockReads += 1;
        if (clockReads === 2) observations.push('elapsed-captured');
        return clockReads === 1 ? 10 : 25;
      },
      validateResult(result, oracle) {
        observations.push('exact-validation');
        return Number.isFinite(result) && result === oracle;
      },
    });
    assert.equal(observed.status, expected, name);
    assert.equal(observed.elapsed_wall_ms, 15, name);
    assert.equal(
      observations.includes('exact-validation'),
      name === 'mismatch' || name === 'ok',
      `${name}: exact validation path mismatch`,
    );
    assert.equal(observations.at(-1), 'elapsed-captured', `${name}: timer stopped before classification`);
  }
});

test('collects paired fresh-process samples in rotating order after warm preparation', () => {
  const work = mkdtempSync(join(tmpdir(), 'vkf-lazy-sampling-'));
  try {
    const logPath = join(work, 'runner.jsonl');
    const runnerPath = join(work, 'runner.mjs');
    writeFileSync(runnerPath, [
      "import { appendFileSync, existsSync, writeFileSync } from 'node:fs';",
      "import { join } from 'node:path';",
      "const marker = join(process.cwd(), 'prepared.marker');",
      "const entry = {",
      "  peer: process.argv[2],",
      "  pid: process.pid,",
      "  boundary: process.env.VKF_BENCHMARK_BOUNDARY,",
      "  phase: process.env.VKF_BENCHMARK_PHASE,",
      "  marker_before: existsSync(marker),",
      "};",
      "appendFileSync(process.env.SAMPLE_LOG, `${JSON.stringify(entry)}\\n`);",
      "writeFileSync(marker, 'prepared');",
      "process.stdout.write('42\\n');",
    ].join('\n'), 'utf8');
    const peers = Object.fromEntries(['vkf', 'polars', 'duckdb'].map((peer) => [peer, {
      command: process.execPath,
      args: [runnerPath, peer],
      env: { SAMPLE_LOG: logPath },
    }]));

    const samples = collectPairedSamples({
      peers,
      fixtureManifest: { expected_sum: 42 },
      rounds: 2,
      timeoutMs: 2_000,
      workRoot: join(work, 'sample-work'),
    });

    assert.deepEqual(samples.map(({ peer, boundary, round, order, status, result }) => ({
      peer, boundary, round, order, status, result,
    })), [
      { peer: 'vkf', boundary: 'fresh_source_e2e', round: 0, order: 0, status: 'OK', result: 42 },
      { peer: 'polars', boundary: 'fresh_source_e2e', round: 0, order: 1, status: 'OK', result: 42 },
      { peer: 'duckdb', boundary: 'fresh_source_e2e', round: 0, order: 2, status: 'OK', result: 42 },
      { peer: 'vkf', boundary: 'warm_source_e2e', round: 0, order: 0, status: 'OK', result: 42 },
      { peer: 'polars', boundary: 'warm_source_e2e', round: 0, order: 1, status: 'OK', result: 42 },
      { peer: 'duckdb', boundary: 'warm_source_e2e', round: 0, order: 2, status: 'OK', result: 42 },
      { peer: 'polars', boundary: 'fresh_source_e2e', round: 1, order: 0, status: 'OK', result: 42 },
      { peer: 'duckdb', boundary: 'fresh_source_e2e', round: 1, order: 1, status: 'OK', result: 42 },
      { peer: 'vkf', boundary: 'fresh_source_e2e', round: 1, order: 2, status: 'OK', result: 42 },
      { peer: 'polars', boundary: 'warm_source_e2e', round: 1, order: 0, status: 'OK', result: 42 },
      { peer: 'duckdb', boundary: 'warm_source_e2e', round: 1, order: 1, status: 'OK', result: 42 },
      { peer: 'vkf', boundary: 'warm_source_e2e', round: 1, order: 2, status: 'OK', result: 42 },
    ]);
    assert.ok(samples.every(({ elapsed_wall_ms }) => elapsed_wall_ms >= 0));

    const invocations = readFileSync(logPath, 'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(invocations.length, 15);
    assert.equal(new Set(invocations.map(({ pid }) => pid)).size, invocations.length);
    assert.deepEqual(
      invocations.slice(0, 3).map(({ peer, phase, marker_before }) => ({
        peer, phase, marker_before,
      })),
      ['vkf', 'polars', 'duckdb'].map((peer) => ({
        peer, phase: 'preparation', marker_before: false,
      })),
    );
    assert.ok(invocations
      .filter(({ boundary, phase }) => boundary === 'fresh_source_e2e' && phase === 'sample')
      .every(({ marker_before }) => marker_before === false));
    assert.ok(invocations
      .filter(({ boundary, phase }) => boundary === 'warm_source_e2e' && phase === 'sample')
      .every(({ marker_before }) => marker_before === true));
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test('retains exact-oracle failures and timeouts as raw samples', () => {
  const work = mkdtempSync(join(tmpdir(), 'vkf-lazy-sampling-failures-'));
  try {
    const runnerPath = join(work, 'runner.mjs');
    writeFileSync(runnerPath, [
      "if (process.env.VKF_BENCHMARK_PHASE === 'preparation') {",
      "  process.stdout.write('42\\n');",
      "} else if (process.argv[2] === 'duckdb') {",
      "  setInterval(() => {}, 10_000);",
      "} else {",
      "  process.stdout.write(process.argv[2] === 'polars' ? '43\\n' : '42\\n');",
      "}",
    ].join('\n'), 'utf8');
    const peers = Object.fromEntries(['vkf', 'polars', 'duckdb'].map((peer) => [peer, {
      command: process.execPath,
      args: [runnerPath, peer],
    }]));

    const samples = collectPairedSamples({
      peers,
      fixtureManifest: { expected_sum: 42 },
      rounds: 1,
      timeoutMs: 1_000,
      workRoot: join(work, 'sample-work'),
    });

    assert.equal(samples.length, 6);
    assert.deepEqual(samples.map(({ peer, boundary, status, result }) => ({
      peer, boundary, status, result,
    })), [
      { peer: 'vkf', boundary: 'fresh_source_e2e', status: 'OK', result: 42 },
      { peer: 'polars', boundary: 'fresh_source_e2e', status: 'ORACLE_MISMATCH', result: 43 },
      { peer: 'duckdb', boundary: 'fresh_source_e2e', status: 'TIMEOUT', result: null },
      { peer: 'vkf', boundary: 'warm_source_e2e', status: 'OK', result: 42 },
      { peer: 'polars', boundary: 'warm_source_e2e', status: 'ORACLE_MISMATCH', result: 43 },
      { peer: 'duckdb', boundary: 'warm_source_e2e', status: 'TIMEOUT', result: null },
    ]);
    assert.ok(samples.every(({ elapsed_wall_ms }) => elapsed_wall_ms >= 0));
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test('samples the three verified public peers without producing a comparison claim', {
  skip: Object.values(publicRunners).every(Boolean)
    ? false
    : 'VKF, Polars, and DuckDB runners are not all configured',
  timeout: 180_000,
}, () => {
  for (const [peer, runner] of Object.entries(publicRunners)) {
    assert.equal(existsSync(runner), true, `${peer} runner does not exist`);
  }
  const work = mkdtempSync(join(tmpdir(), 'vkf-lazy-real-sampling-'));
  try {
    const fixturePath = join(work, 'fixture.csv');
    const fixtureManifest = writeFixture(fixturePath, { rows: 128, rowsPerChunk: 17 });
    const receipt = buildSamplingReceipt({
      fixturePath,
      fixtureManifest,
      runners: publicRunners,
      revision: 'i53-test-revision',
      rounds: 1,
      timeoutMs: 60_000,
      workRoot: join(work, 'runner-work'),
    });

    assert.equal(receipt.status, 'sampled_non_gating');
    assert.equal(receipt.non_gating, true);
    assert.deepEqual(Object.fromEntries(['vkf', 'polars', 'duckdb'].map((peer) => [
      peer, receipt.peers[peer].status,
    ])), { vkf: 'AVAILABLE', polars: 'AVAILABLE', duckdb: 'AVAILABLE' });
    assert.equal(receipt.samples.length, 6);
    assert.ok(receipt.samples.every(({ status }) => status === 'OK'));
    assert.ok(receipt.samples.every(({ result }) => result === fixtureManifest.expected_sum));
    assert.deepEqual(receipt.comparisons, []);
    assert.equal(receipt.peers.vaex.status, 'UNAVAILABLE');
    assert.equal(receipt.peers.dask.status, 'UNAVAILABLE');
    assert.deepEqual(receipt.sampling, {
      rounds: 1,
      timeout_ms: 60_000,
      peer_order: ['vkf', 'polars', 'duckdb'],
      order: 'paired_rotating_same_host',
      outliers: 'retain_all',
      os_cache: 'uncontrolled_reported',
    });

    const cliOutput = join(work, 'sampling-receipt.json');
    const cli = spawnSync(process.execPath, [
      join(import.meta.dirname, 'run.mjs'),
      `--fixture=${join(work, 'cli-fixture.csv')}`,
      '--rows=128',
      `--output=${cliOutput}`,
      '--revision=i53-cli-revision',
      '--sample-rounds=1',
      '--sample-timeout-ms=60000',
      `--vkf-runner=${publicRunners.vkf}`,
      `--polars-runner=${publicRunners.polars}`,
      `--duckdb-runner=${publicRunners.duckdb}`,
    ], { encoding: 'utf8', timeout: 180_000, windowsHide: true });
    assert.equal(cli.error, undefined, cli.error?.message);
    assert.equal(cli.status, 0, `${cli.stdout}\n${cli.stderr}`);
    const cliReceipt = JSON.parse(readFileSync(cliOutput, 'utf8'));
    assert.equal(cliReceipt.status, 'sampled_non_gating');
    assert.equal(cliReceipt.samples.length, 6);
    assert.deepEqual(cliReceipt.comparisons, []);
  } finally {
    rmSync(work, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
});
