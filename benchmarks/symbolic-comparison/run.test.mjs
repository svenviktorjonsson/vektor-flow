import assert from 'node:assert/strict';
import test from 'node:test';

import {
  comparisonGate,
  formatRatio,
  parseKeyValueOutput,
  parseVkfOutput,
  seriesStats,
} from './run.mjs';

test('parses competitor key/value output', () => {
  assert.deepEqual(
    parseKeyValueOutput('version=1\nelapsed_ms=2.5\noutput=2998\n'),
    {
      elapsedMs: 2.5,
      output: 2998,
      fields: { version: '1', elapsed_ms: '2.5', output: '2998' },
    },
  );
});

test('parses exactly two VKF result lines', () => {
  assert.deepEqual(parseVkfOutput('0.25\n39711\n'), { elapsedMs: 0.25, output: 39711 });
  assert.throws(() => parseVkfOutput('0.25\n39711\nextra\n'));
});

test('uses sample standard deviation', () => {
  assert.deepEqual(seriesStats([1, 2, 3]), { count: 3, meanMs: 2, stddevMs: 1 });
});

test('gate treats censored competitor mean as a conservative lower bound', () => {
  assert.deepEqual(comparisonGate(8, {
    censored: true,
    meanLowerBoundMs: 6,
  }), {
    ratio: undefined,
    ratioUpperBound: 8 / 6,
    pass: true,
  });
  assert.equal(comparisonGate(10, {
    censored: true,
    meanLowerBoundMs: 6,
  }).pass, false);
});

test('gate enforces an explicit release-relative limit', () => {
  const competitor = {
    censored: false,
    stats: { meanMs: 10 },
  };
  assert.equal(comparisonGate(14.99, competitor, 1.5).pass, true);
  assert.equal(comparisonGate(15, competitor, 1.5).pass, false);
});

test('very small ratios remain visibly nonzero', () => {
  assert.equal(formatRatio(0.000344596), '3.45e-4×');
  assert.equal(formatRatio(0.000234849, true), '<2.35e-4×');
});
