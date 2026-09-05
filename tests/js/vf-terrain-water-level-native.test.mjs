import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import test from 'node:test';
import { createConditionedRoot, conditionedNodeStreamReference } from '../../web/vf-ui/vf-conditioned-distribution.mjs';
import { sampleSpatialCorrelation2Reference } from '../../web/vf-ui/vf-spatial-correlation.mjs';

// Test-only authored conditions, not public terrain identity names or defaults.
const identity = { generator: 'vkf.conditioned', version: 1, seed: [1, 2],
  domain: 'material', hierarchy: ['test:terrain'], lod: 0, channel: 'test:height' };
const executable = process.env.VKF_TERRAIN_PROBE ?? resolve('build/terrain/native-probe');
if (!process.env.VKF_TERRAIN_PROBE) {
  mkdirSync('build/terrain', { recursive: true });
  const built = spawnSync(process.env.CXX ?? 'g++', ['-std=c++20', '-O2', '-ffp-contract=off',
    '-Wall', '-Wextra', '-Werror', '-pedantic', '-I.', 'tools/terrain-water-level-probe.cpp', '-o', executable], { encoding: 'utf8' });
  assert.equal(built.status, 0, `${built.error ?? ''}${built.stdout}${built.stderr}`);
}
const bits = value => {
  const buffer = Buffer.alloc(8);
  buffer.writeDoubleLE(value);
  return buffer.readBigUInt64LE();
};
function run({ tile = [-1, 2], level = 4, budget = 289, seed = identity.seed,
  correlationLength = 4, mean = 0, amplitude = 2, waterLevel = 0.25,
  exposed = 101, submerged = 202 } = {}, error) {
  const node = createConditionedRoot({ ...identity, seed });
  const stream = conditionedNodeStreamReference(node);
  const input = [...tile, level, budget, ...stream.key, ...stream.counterPrefix,
    ...[correlationLength, mean, amplitude, waterLevel].map(bits), exposed, submerged].join(' ');
  const native = spawnSync(executable, [], { input, timeout: 30000, maxBuffer: 16 * 1024 * 1024 });
  if (error) {
    assert.equal(native.status, 1, `${native.error ?? ''}${native.stderr}`);
    assert.equal(native.stderr.toString(), `${error}\n`);
    assert.equal(native.stdout.length, 0, 'rejected demand published a partial terrain');
    return;
  }
  assert.equal(native.status, 0, `${native.error ?? ''}${native.stderr}`);
  const divisions = 2 ** level, width = divisions + 1;
  const count = Math.min(width * width, budget);
  const expected = Buffer.alloc(20 + count * 28);
  expected.writeBigUInt64LE(BigInt(count));
  expected.writeBigUInt64LE(BigInt(width * width), 8);
  expected.writeUInt32LE(Number(count < width * width), 16);
  for (let index = 0; index < count; ++index) {
    const x = tile[0] + (index % width) / divisions;
    const z = tile[1] + Math.floor(index / width) / divisions;
    const height = sampleSpatialCorrelation2Reference(node, [x, z], { correlationLength, mean, amplitude });
    expected.writeDoubleLE(x, 20 + index * 28);
    expected.writeDoubleLE(height, 28 + index * 28);
    expected.writeDoubleLE(z, 36 + index * 28);
    expected.writeUInt32LE(height <= waterLevel ? submerged : exposed, 44 + index * 28);
  }
  assert.deepEqual(native.stdout, expected, 'native terrain/material bytes differ from existing spatial truth');
  return native.stdout;
}

test('terrain and water-level materials consume existing spatial field bytes exactly', () => {
  for (const tile of [[-1, 2], [0, 2], [-7, -13], [123, 57]])
    for (const level of [0, 2, 4]) run({ tile, level });
  for (const tile of [[-2147483648, 0], [2147483647, -2147483648]])
    run({ tile, level: 16, budget: 101 });
});
test('seed, condition, replay, and demand order preserve exact terrain bytes', () => {
  const first = run();
  for (const seed of [[0, 0], [0xffffffff, 0xffffffff], [67, 89]])
    for (const budget of [0, 1, 101, 289])
      run({ seed, budget, correlationLength: 0.75, mean: -7, amplitude: 11, waterLevel: -2 });
  assert.deepEqual(run(), first);
});
test('terrain stays bounded at full demand with billions of potential samples', () => {
  const result = run({ level: 16, budget: 65536 });
  assert.equal(result.length, 20 + 65536 * 28);
  assert.equal(result.readBigUInt64LE(8), 4295098369n);
  assert.equal(result.readUInt32LE(16), 1);
});
test('material IDs and changed water levels do not change geometry', () => {
  const dry = run({ waterLevel: -3, exposed: 0xffffffff });
  const submerged = run({ waterLevel: 3, submerged: 0 });
  for (let offset = 20; offset < dry.length; offset += 28)
    assert.deepEqual(dry.subarray(offset, offset + 24), submerged.subarray(offset, offset + 24));
  run({ amplitude: 0, mean: 0.25, waterLevel: 0.25 });
});
test('terrain retains precise private validation order and existing spatial diagnostics', () => {
  run({ level: 17, budget: 65537, correlationLength: 0 }, 'terrain refinement must be from 0 to 16');
  run({ budget: 65537, correlationLength: 0 }, 'terrain sample budget must be from 0 to 65536');
  for (const budget of [0, 1, 289]) {
    run({ budget, correlationLength: 0, mean: NaN }, 'spatial correlation length must be finite and positive');
    run({ budget, mean: NaN, amplitude: -1 }, 'spatial correlation mean must be finite');
    run({ budget, amplitude: -1 }, 'spatial correlation amplitude must be finite and non-negative');
    run({ budget, tile: [2147483646, 0], correlationLength: 1 }, 'spatial correlation position exceeds the bounded lattice domain');
    run({ budget, waterLevel: NaN }, 'terrain water level must be finite');
  }
});
