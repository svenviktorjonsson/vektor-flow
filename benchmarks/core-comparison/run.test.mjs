import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertVkfAcceptanceBudgets,
  benchmarkWorkRoot,
  parseBatchCompileSummaries,
  parseOptions,
  seriesStats,
  valuesAgree
} from './run.mjs';

test('100-run VKF scalar gate requires under 10 ms compile and 0.5 ms raw runtime', () => {
  const result = (compileMeanMs, nativeRuntimeMeanMs, count = 100) => ({
    case: 'scalar-control-small',
    language: 'vkf',
    compile: { count, meanMs: compileMeanMs },
    nativeRuntime: { count, meanMs: nativeRuntimeMeanMs }
  });
  assert.doesNotThrow(() => assertVkfAcceptanceBudgets([result(9.999, 0.499)]));
  assert.throws(
    () => assertVkfAcceptanceBudgets([result(10, 0.499)]),
    /compile 10\.000000 ms must be under 10\.000 ms/
  );
  assert.throws(
    () => assertVkfAcceptanceBudgets([result(9, 0.5)]),
    /raw runtime 0\.500000 ms must be under 0\.500 ms/
  );
  assert.doesNotThrow(() => assertVkfAcceptanceBudgets([result(100, 100, 10)]));
});

test('Windows benchmark work stays off synced repository storage', () => {
  assert.equal(
    benchmarkWorkRoot('win32', 'C:\\Users\\tester\\AppData\\Local\\Temp'),
    'C:\\Users\\tester\\AppData\\Local\\Temp\\vektor-flow-core-comparison'
  );
  assert.equal(
    benchmarkWorkRoot('linux', '/tmp', '/repo/benchmarks/core-comparison/.work'),
    'C:\\repo\\benchmarks\\core-comparison\\.work'
  );
});

test('batch compiler summaries preserve fresh-artifact timings', () => {
  const summaries = parseBatchCompileSummaries([
    JSON.stringify({ batch_ms: 12.5, artifact_path: 'first.exe', artifact_fallback: false }),
    JSON.stringify({ batch_ms: 9.25, artifact_path: 'second.exe', artifact_fallback: false })
  ].join('\n'), 2);
  assert.deepEqual(summaries.map(({ batch_ms, artifact_path }) => ({ batch_ms, artifact_path })), [
    { batch_ms: 12.5, artifact_path: 'first.exe' },
    { batch_ms: 9.25, artifact_path: 'second.exe' }
  ]);
  assert.throws(() => parseBatchCompileSummaries('{}', 2), /expected 2/);
  assert.throws(
    () => parseBatchCompileSummaries(JSON.stringify({ batch_ms: -1 }), 1),
    /invalid batch_ms/
  );
});

test('seriesStats reports mean, spread, p95, and confidence interval', () => {
  assert.deepEqual(seriesStats([1, 2, 3, 4]), {
    count: 4,
    meanMs: 2.5,
    medianMs: 2.5,
    minMs: 1,
    maxMs: 4,
    p95Ms: 4,
    stddevMs: 1.290994,
    ci95LowerMs: 1.234825,
    ci95UpperMs: 3.765175
  });
});

test('valuesAgree uses combined relative and absolute tolerance', () => {
  assert.equal(valuesAgree(1_000_000, 1_000_000.0005, 1e-9), true);
  assert.equal(valuesAgree(1, 1.01, 1e-9), false);
});

test('parseOptions accepts positive integer sample controls', () => {
  assert.deepEqual(parseOptions([
    '--case=startup',
    '--language=vkf',
    '--output=probe-results',
    '--compile-runs=7',
    '--compile-warmups=2',
    '--runs=21',
    '--warmups=4'
  ]), {
    caseId: 'startup',
    languageId: 'vkf',
    outputStem: 'probe-results',
    compileRuns: 7,
    compileWarmups: 2,
    runs: 21,
    warmups: 4
  });
  assert.throws(() => parseOptions(['--runs=0']), /positive integer/);
  assert.throws(() => parseOptions(['--output=../escape']), /safe result name/);
  assert.throws(() => parseOptions(['--wat=2']), /unknown option/);
});

test('parseOptions defaults to 100 measured compile and runtime runs', () => {
  assert.deepEqual(parseOptions([]), {
    caseId: null,
    languageId: null,
    outputStem: 'latest',
    compileRuns: 100,
    compileWarmups: 1,
    runs: 100,
    warmups: 5
  });
});
