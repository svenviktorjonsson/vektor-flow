import assert from 'node:assert/strict';
import { availableParallelism } from 'node:os';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';

import { runAutomaticCpuBenchmark } from './run.mjs';

const compiler = process.env.VKF_AUTOMATIC_CPU_COMPILER;
const configuredWorkRoot = resolve(
  process.env.VKF_TEST_WORK_ROOT ?? join(import.meta.dirname, '.work'),
);

test('large pure demands are faster with four configured CPUs than one', {
  skip: process.platform === 'win32' && compiler && availableParallelism() >= 4
    ? false
    : 'Windows compiler and four logical CPUs are required',
  timeout: 300_000,
}, () => {
  assert.equal(existsSync(compiler), true, 'configured VKF compiler does not exist');
  mkdirSync(configuredWorkRoot, { recursive: true });
  const work = mkdtempSync(join(configuredWorkRoot, 'i86-benchmark-'));
  try {
    const result = runAutomaticCpuBenchmark({
      compiler,
      workRoot: work,
      samples: 5,
      iterationsPerLane: 250_000_000,
    });
    assert.equal(result.schemaVersion, 1);
    assert.equal(result.correctness.equalOutputs, true);
    assert.equal(result.oneCore.groupSelected, false);
    assert.equal(result.fourCore.groupSelected, true);
    assert.deepEqual(result.oneCore.output, result.fourCore.output);
    assert.equal(result.oneCore.samplesMs.length, 5);
    assert.equal(result.fourCore.samplesMs.length, 5);
    for (const summary of [result.oneCore, result.fourCore]) {
      for (const name of ['meanMs', 'sampleStddevMs', 'medianMs', 'p95Ms', 'minMs', 'maxMs']) {
        assert.equal(Number.isFinite(summary[name]), true, `${name} is not finite`);
        assert.equal(summary[name] > 0, true, `${name} is not positive`);
      }
      assert.equal(summary.minMs <= summary.medianMs, true);
      assert.equal(summary.medianMs <= summary.p95Ms, true);
      assert.equal(summary.p95Ms <= summary.maxMs, true);
    }
    assert.equal(
      result.speedup.median >= 1.10,
      true,
      `four configured CPUs did not separate from one: ${JSON.stringify(result.speedup)}`,
    );
  } finally {
    rmSync(work, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
});
