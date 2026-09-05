import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
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
  exposed = 101, submerged = 202, samplingDistance } = {}, error) {
  const node = createConditionedRoot({ ...identity, seed });
  const stream = conditionedNodeStreamReference(node);
  const input = [...tile, level, budget, ...stream.key, ...stream.counterPrefix,
    ...[correlationLength, mean, amplitude, waterLevel].map(bits), exposed, submerged,
    ...(samplingDistance === undefined ? [] : [bits(samplingDistance)])].join(' ');
  const native = spawnSync(executable, samplingDistance === undefined ? [] : ['--normals'],
    { input, timeout: 30000, maxBuffer: 16 * 1024 * 1024 });
  if (error) {
    assert.equal(native.status, 1, `${native.error ?? ''}${native.stderr}`);
    assert.equal(native.stderr.toString(), `${error}\n`);
    assert.equal(native.stdout.length, 0, 'rejected demand published a partial terrain');
    return;
  }
  assert.equal(native.status, 0, `${native.error ?? ''}${native.stderr}`);
  const divisions = 2 ** level, width = divisions + 1;
  const count = Math.min(width * width, budget);
  const stride = samplingDistance === undefined ? 28 : 52;
  const expected = Buffer.alloc(20 + count * stride);
  expected.writeBigUInt64LE(BigInt(count));
  expected.writeBigUInt64LE(BigInt(width * width), 8);
  expected.writeUInt32LE(Number(count < width * width), 16);
  for (let index = 0; index < count; ++index) {
    const x = tile[0] + (index % width) / divisions;
    const z = tile[1] + Math.floor(index / width) / divisions;
    const height = sampleSpatialCorrelation2Reference(node, [x, z], { correlationLength, mean, amplitude });
    const offset = 20 + index * stride;
    expected.writeDoubleLE(x, offset);
    expected.writeDoubleLE(height, offset + 8);
    expected.writeDoubleLE(z, offset + 16);
    if (samplingDistance !== undefined) {
      const sample = (px, pz) => sampleSpatialCorrelation2Reference(node, [px, pz], { correlationLength, mean, amplitude });
      const slopeX = (sample(x + samplingDistance, z) - sample(x - samplingDistance, z)) / (2 * samplingDistance);
      const slopeZ = (sample(x, z + samplingDistance) - sample(x, z - samplingDistance)) / (2 * samplingDistance);
      const length = Math.sqrt(slopeX * slopeX + 1 + slopeZ * slopeZ);
      expected.writeDoubleLE(-slopeX / length, offset + 24);
      expected.writeDoubleLE(1 / length, offset + 32);
      expected.writeDoubleLE(-slopeZ / length, offset + 40);
    }
    expected.writeUInt32LE(height <= waterLevel ? submerged : exposed, offset + stride - 4);
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

test('surface normals consume the same height field with exact cross-language bytes', () => {
  for (const tile of [[-1, 2], [0, 2], [-1, 3], [-7, -13]])
    for (const level of [0, 3, 4]) run({ tile, level, samplingDistance: 0.015625 });
  run({ amplitude: 0, samplingDistance: 0.015625 });
  run({ tile: [2147483647, -2147483648], level: 16, budget: 101, samplingDistance: 0.125 });
});
test('normal surface bytes preserve replay, seed, demand, and explicit sampling distance', () => {
  const original = run({ samplingDistance: 0.015625 });
  for (const seed of [[67, 89], [0xffffffff, 0xffffffff]])
    for (const budget of [0, 1, 101, 289])
      for (const samplingDistance of [0.015625, 0.125])
        run({ seed, budget, samplingDistance, correlationLength: 0.75, mean: -7, amplitude: 11 });
  assert.deepEqual(run({ samplingDistance: 0.015625 }), original);
});
test('surface packet normal demand remains bounded at 65536 samples', () => {
  const result = run({ level: 16, budget: 65536, samplingDistance: 0.015625 });
  assert.equal(result.length, 20 + 65536 * 52);
});
test('normal generation rejects non-finite, collapsed, and out-of-domain stencils exactly', () => {
  for (const budget of [0, 1]) {
    for (const samplingDistance of [0, -1, NaN, Infinity])
      run({ budget, samplingDistance }, 'terrain normal sampling distance must be finite and positive');
    run({ budget, correlationLength: 1e308, samplingDistance: 1e308 }, 'terrain normal sampling span must be finite');
  }
  run({ samplingDistance: Number.MIN_VALUE }, 'terrain normal sampling distance is not representable at position');
  run({ amplitude: 1e200, samplingDistance: 0.015625 }, 'terrain normal length must be finite and positive');
  run({ tile: [2147483645, 0], correlationLength: 1, samplingDistance: 2 },
    'spatial correlation position exceeds the bounded lattice domain');
});

test('original terrain/material hashes remain equal to the d66ef996 committed baseline', () => {
  const cases = [
    [[-1, 2], 3, 81, '5223aca718ee5b0bbbb5701300811a0479e0fa345a8720c2b4cae94471796f5b'],
    [[0, 2], 3, 81, '02cf51dee884a96afd661179c9f2f44ceaac5d7b8fd4bb3fd06d5506dd36497f'],
    [[-1, 3], 3, 81, '95455f1e1bbda863961dc7c03d5e4cf5beed034f139c067ab7d4b589fbd1e33b'],
    [[-1, 2], 4, 289, 'd636f4afa4985d90a76bac255f7e3a3a5d3f5c7873e4d59763be893f3312c46e'],
    [[-1, 2], 16, 0, '6a0ac59a243a9f13b9749049143ab1c4dda4b2be399cdbd4b317ebfdd9b3924a'],
    [[-1, 2], 16, 101, 'd27f641aacf74205db3532238fbc0733968ddeba03925f1a1ed48044249c3cc9'],
    [[-1, 2], 16, 65536, 'e1c0539a8261acd4b6032b19a40492a139af315e64956a0ab3af791d231807e6'],
    [[2147483647, -2147483648], 16, 101, 'f380ed61b4c3de35117ffc5b091b51cc2a19d6182e392076b33111e48cb10c6f'],
  ];
  for (const [tile, level, budget, hash] of cases) {
    const input = [...tile, level, budget, 1, 2, 3, 4, ...[4, 0, 2, 0.25].map(bits), 101, 202].join(' ');
    const native = spawnSync(executable, [], { input, timeout: 30000, maxBuffer: 16 * 1024 * 1024 });
    assert.equal(native.status, 0, `${native.error ?? ''}${native.stderr}`);
    assert.equal(createHash('sha256').update(native.stdout).digest('hex'), hash);
  }
});
