import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertCrossLanguageParity,
  assertVkfAcceptanceBudgets,
  assertVkfRelativeKernelGate,
  benchmarkWorkRoot,
  parseBatchCompileSummaries,
  parseNumericOutput,
  parseOptions,
  seriesStats,
  vkfCompileArguments,
  vkfRuntimePreparationArguments,
  valuesAgree
} from './run.mjs';

test('parity failures name the actual reference language', () => {
  assert.throws(
    () => assertCrossLanguageParity('n-body-large', 1e-9, [
      { language: 'vkf', value: 0.1819 },
      { language: 'c', value: -0.1691 }
    ]),
    /n-body-large mismatch: vkf=0\.1819, c=-0\.1691/
  );
});

test('measured VKF compilation forces a fresh optimizer search', () => {
  assert.deepEqual(vkfCompileArguments('/tmp/program.vkf'), [
    '--aot',
    '--optimizer-policy', 'tune',
    '--optimizer-time-limit-ms', '80',
    '--source', '/tmp/program.vkf'
  ]);
});

test('runtime proof reuses the measured optimizer policy', () => {
  assert.deepEqual(vkfRuntimePreparationArguments('/tmp/program.vkf', 'mask-c8'), [
    '--aot',
    '--diagnostics',
    '--optimizer-policy', 'mask-c8',
    '--source', '/tmp/program.vkf'
  ]);
  assert.throws(
    () => vkfRuntimePreparationArguments('/tmp/program.vkf', 'tune'),
    /invalid measured VKF optimizer policy/
  );
});

test('relative kernel gate evaluates each same-host language pair independently', () => {
  const row = (caseId, language, meanMs, count = 100) => ({
    case: caseId,
    language,
    nativeRuntime: { count, meanMs }
  });
  const passing = [
    row('spectral-norm-large', 'vkf', 1.99),
    row('spectral-norm-large', 'c', 1),
    row('spectral-norm-large', 'rust', 1.01),
    row('spectral-norm-large', 'zig', 1.02)
  ];
  assert.doesNotThrow(() => assertVkfRelativeKernelGate(passing));
  assert.throws(
    () => assertVkfRelativeKernelGate([
      ...passing.filter((result) => result.language !== 'rust'),
      row('spectral-norm-large', 'rust', 0.995)
    ]),
    /spectral-norm-large vs rust: 2\.0000x must be under 2\.0x/
  );
  assert.doesNotThrow(() => assertVkfRelativeKernelGate([
    row('fannkuch-redux-large', 'vkf', 10, 50),
    row('fannkuch-redux-large', 'c', 1, 50)
  ]));
});

test('numeric benchmark validation rejects missing or repeated output', () => {
  assert.equal(parseNumericOutput('21\n', 'vkf', 'scalar'), 21);
  assert.throws(
    () => parseNumericOutput('21\n21\n', 'vkf', 'scalar'),
    /exactly one numeric result; got 2/
  );
  assert.throws(
    () => parseNumericOutput('', 'vkf', 'scalar'),
    /exactly one numeric result; got 0/
  );
  assert.throws(
    () => parseNumericOutput('not-a-number\n', 'vkf', 'scalar'),
    /did not print one finite numeric result/
  );
});

test('100-run VKF scalar gate requires under 10 ms compiler core and 0.5 ms raw runtime', () => {
  const result = (compileMeanMs, nativeRuntimeMeanMs, count = 100) => ({
    case: 'scalar-control-small',
    language: 'vkf',
    internalCompile: { count, meanMs: compileMeanMs },
    nativeRuntime: { count, meanMs: nativeRuntimeMeanMs }
  });
  assert.doesNotThrow(() => assertVkfAcceptanceBudgets([result(9.999, 0.499)]));
  assert.throws(
    () => assertVkfAcceptanceBudgets([result(10, 0.499)]),
    /compiler core 10\.000000 ms must be under 10\.000 ms/
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
    '--warmups=4',
    '--process-runs=3',
    '--process-warmups=1'
  ]), {
    caseId: 'startup',
    languageId: 'vkf',
    outputStem: 'probe-results',
    compileRuns: 7,
    compileWarmups: 2,
    runs: 21,
    warmups: 4,
    processRuns: 3,
    processWarmups: 1,
    enforceRelativeGate: false
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
    warmups: 5,
    processRuns: 10,
    processWarmups: 1,
    enforceRelativeGate: false
  });
});

test('relative performance gate is explicit rather than a release prerequisite', () => {
  assert.equal(parseOptions(['--enforce-relative-gate=true']).enforceRelativeGate, true);
  assert.equal(parseOptions(['--enforce-relative-gate=false']).enforceRelativeGate, false);
  assert.throws(
    () => parseOptions(['--enforce-relative-gate=sometimes']),
    /must be true or false/
  );
});
