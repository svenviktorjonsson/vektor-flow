import { INDICATOR_PROTOCOL } from './protocol.mjs';

export const SUITE_IMPLEMENTATIONS = Object.freeze([
  'raw-webgpu-floor',
  'three-js-webgl2',
  'deck-gl-scatterplot',
  'vkf-marker-impostor',
]);
export const SUITE_IMPLEMENTATION_QUERIES = Object.freeze([
  'raw-webgpu',
  'three',
  'deck-gl',
  'vkf',
]);
export const SUITE_REPEATS = 3;

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function aggregateRunMeans(values) {
  if (!Array.isArray(values) || values.length < 2 || values.some((value) => !Number.isFinite(value))) {
    throw new TypeError('run-level aggregate requires at least two finite independent run means');
  }
  const average = mean(values);
  const sampleStddev = Math.sqrt(
    values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1),
  );
  const tCritical = values.length === 3 ? 4.302652729696142 : 1.96;
  const margin = tCritical * sampleStddev / Math.sqrt(values.length);
  return Object.freeze({
    independentRuns: values.length,
    meanOfRunMeansMs: average,
    sampleStddevOfRunMeansMs: sampleStddev,
    confidence95MeanMs: [average - margin, average + margin],
    rawRunMeansMs: [...values],
    method: values.length === 3
      ? 'two-sided Student t interval, df=2'
      : 'two-sided normal approximation',
  });
}

export function validateSuiteMatrix(rows, expectedEnvironment) {
  if (!Array.isArray(rows)) throw new TypeError('suite rows must be an array');
  const expectedKeys = [];
  for (const implementation of SUITE_IMPLEMENTATIONS) {
    for (const pointSizePx of INDICATOR_PROTOCOL.pointSizesPx) {
      expectedKeys.push(`${implementation}:${pointSizePx}`);
    }
  }
  const actualKeys = rows.map((row) => `${row.implementation}:${row.pointSizePx}`).sort();
  if (JSON.stringify(actualKeys) !== JSON.stringify([...expectedKeys].sort())) {
    throw new Error('suite must publish every implementation with both 1px and 4px rows exactly once');
  }
  for (const row of rows) {
    if (!Array.isArray(row.runs) || row.runs.length !== SUITE_REPEATS) {
      throw new Error(`suite row ${row.implementation}:${row.pointSizePx} requires ${SUITE_REPEATS} runs`);
    }
    for (const run of row.runs) {
      if (run.environmentKey !== expectedEnvironment) {
        throw new Error('suite rows do not share one pinned environment');
      }
      if (run.result?.correctness?.passed !== true) throw new Error('suite correctness gate failed');
      const retained = run.result?.timing?.retainedAfterTiming;
      if (retained?.fixtureBufferWritesAfterInitialize !== 0
        || retained?.fixtureBufferReallocationsAfterInitialize !== 0) {
        throw new Error('suite retention gate failed');
      }
    }
  }
  return true;
}
