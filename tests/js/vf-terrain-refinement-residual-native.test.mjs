import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import test from 'node:test';
import { createConditionedRoot, conditionedNodeStreamReference } from '../../web/vf-ui/vf-conditioned-distribution.mjs';
import { sampleSpatialCorrelation2Reference } from '../../web/vf-ui/vf-spatial-correlation.mjs';

const executable = process.env.VKF_TERRAIN_RESIDUAL_PROBE ?? resolve('build/terrain/residual-probe');
const nativeTest = process.env.VKF_TERRAIN_RESIDUAL_TEST ?? resolve('build/terrain/refinement-residual-native');
if (!process.env.VKF_TERRAIN_RESIDUAL_PROBE) {
  mkdirSync('build/terrain', { recursive: true });
  const built = spawnSync(process.env.CXX ?? 'g++', ['-std=c++20', '-O2', '-ffp-contract=off',
    '-Wall', '-Wextra', '-Werror', '-pedantic', '-I.', 'tools/terrain-refinement-residual-probe.cpp',
    '-o', executable], { encoding: 'utf8' });
  assert.equal(built.status, 0, `${built.error ?? ''}${built.stdout}${built.stderr}`);
}
if (!process.env.VKF_TERRAIN_RESIDUAL_TEST) {
  const built = spawnSync(process.env.CXX ?? 'g++', ['-std=c++20', '-O2', '-ffp-contract=off',
    '-Wall', '-Wextra', '-Werror', '-pedantic', '-I.', 'native/material/vf_terrain_refinement_residual_test.cpp',
    '-o', nativeTest], { encoding: 'utf8' });
  assert.equal(built.status, 0, `${built.error ?? ''}${built.stdout}${built.stderr}`);
}
const identity = { generator: 'vkf.conditioned', version: 1, seed: [1, 2], domain: 'material',
  hierarchy: ['test:terrain'], lod: 0, channel: 'test:height' };
const bits = value => { const bytes = Buffer.alloc(8); bytes.writeDoubleLE(value); return bytes.readBigUInt64LE(); };
function run({ tile = [-1, 2], level = 3, sampleBudget = 65536, seed = identity.seed,
  correlationLength = 0.125, mean = 0, amplitude = 2, waterLevel = 0.25, samplingDistance = 1 / 1024,
  parents = [7, 0, 56], parentBudget = parents.length } = {}, error) {
  const node = createConditionedRoot({ ...identity, seed }), stream = conditionedNodeStreamReference(node);
  const input = [...tile, level, sampleBudget, ...stream.key, ...stream.counterPrefix,
    ...[correlationLength, mean, amplitude, waterLevel, samplingDistance].map(bits), parentBudget, parents.length, ...parents].join(' ');
  const result = spawnSync(executable, [], { input, timeout: 30000, maxBuffer: 16 * 1024 * 1024 });
  if (error) {
    assert.equal(result.status, 1, `${result.error ?? ''}${result.stderr}`);
    assert.equal(result.stderr.toString(), `${error}\n`);
    assert.equal(result.stdout.length, 0, 'rejected residual published partial output');
    return;
  }
  assert.equal(result.status, 0, `${result.error ?? ''}${result.stderr}`);
  assert.equal(result.stderr.length, 0);
  const expected = Buffer.alloc(8 + parents.length * 56), divisions = 2 ** level;
  expected.writeBigUInt64LE(BigInt(parents.length));
  parents.forEach((parent, index) => {
    const x = tile[0] + (parent % divisions) / divisions, z = tile[1] + Math.floor(parent / divisions) / divisions;
    const height = (u, v) => sampleSpatialCorrelation2Reference(node, [x + u / divisions, z + v / divisions],
      { correlationLength, mean, amplitude });
    const old = [height(0, 0), height(1, 0), height(0, 1), height(1, 1)];
    const actual = [height(0.5, 0), height(0, 0.5), height(1, 0.5), height(0.5, 1), height(0.5, 0.5)];
    const errors = [[0, 1], [0, 2], [1, 3], [2, 3], [1, 2]]
      .map(([a, b], point) => Math.abs(actual[point] - (0.5 * old[a] + 0.5 * old[b])));
    const offset = 8 + index * 56;
    expected.writeBigUInt64LE(BigInt(parent), offset);
    [...errors, Math.max(...errors)].forEach((value, point) => expected.writeDoubleLE(value, offset + 8 + point * 8));
  });
  assert.deepEqual(result.stdout, expected, 'sampled residual differs from existing JS field bytes');
  return result.stdout;
}

test('flat and conditioned terrain residuals match every existing JS field byte', () => {
  run({ amplitude: 0 });
  run();
});

test('sampled residuals retain exact seeded field bytes at all supported parent levels', () => {
  for (const seed of [[1, 2], [67, 89]])
    for (let level = 0; level <= 15; ++level) {
      const divisions = 2 ** level;
      const parents = [...new Set([0, divisions - 1, divisions * divisions - 1])];
      for (const tile of [[-1, 2], [0, 2], [-1, 3], [-7, -13]]) run({ seed, level, parents, tile });
    }
  run({ level: 15, parents: [1073741823], tile: [2147483647, -2147483648], correlationLength: 4, samplingDistance: 0.125 });
  run({ mean: -0, amplitude: 0 });
});

test('residual replay and parent permutations preserve geometry-only sampled values', () => {
  const parents = [7, 0, 56], first = run({ parents });
  assert.deepEqual(run({ parents }), first);
  const reversed = run({ parents: parents.toReversed() });
  parents.forEach((_, i) => assert.deepEqual(first.subarray(8 + i * 56, 8 + (i + 1) * 56),
    reversed.subarray(8 + (2 - i) * 56, 8 + (3 - i) * 56)));
  assert.deepEqual(run({ waterLevel: -2 }), first);
  assert.deepEqual(run({ samplingDistance: 1 / 256 }), first);
  assert.equal(run({ parents: [], parentBudget: 0 }).length, 8);
});

test('full resident refinement compares every sampled error without enlarging demand limits', () => {
  const result = run({ level: 7, parents: Array.from({ length: 16256 }, (_, i) => i), sampleBudget: 65535 });
  assert.equal(result.length, 910344);
  assert.equal(result.readBigUInt64LE(), 16256n);
});

test('probe preserves exact malformed demand and finite source diagnostics without partial output', () => {
  run({ parentBudget: 65537 }, 'terrain residual parent budget must be from 0 to 65536');
  run({ parentBudget: 2 }, 'terrain residual demand exceeds parent budget');
  run({ level: 16 }, 'terrain cell refinement requires level from 0 to 15');
  run({ level: 17, sampleBudget: 65537 }, 'terrain refinement must be from 0 to 16');
  run({ sampleBudget: 65537 }, 'terrain sample budget must be from 0 to 65536');
  run({ parents: [0], sampleBudget: 8 }, 'terrain cell demand exceeds sample budget');
  run({ parents: [0, 0, 64] }, 'terrain cell demand is duplicated');
  run({ parents: [64, 0, 0] }, 'terrain cell demand exceeds tile domain');
  run({ parents: Array(65537).fill(0), parentBudget: 0 }, 'terrain cell demand must contain at most 65536 entries');
  run({ correlationLength: 0, mean: NaN }, 'spatial correlation length must be finite and positive');
  run({ mean: NaN }, 'spatial correlation mean must be finite');
  run({ waterLevel: NaN, samplingDistance: 0 }, 'terrain water level must be finite');
  run({ samplingDistance: 0 }, 'terrain normal sampling distance must be finite and positive');
});

test('native residual identity, ownership, finite endpoints and source validation remain exact', () => {
  const result = spawnSync(nativeTest, [], { timeout: 30000, maxBuffer: 65536 });
  assert.equal(result.status, 0, `${result.error ?? ''}${result.stderr}`);
  assert.equal(result.stderr.length, 0);
  assert.equal(result.stdout.toString(), 'terrain refinement residual: sampled=exact source=owned\n');
});
