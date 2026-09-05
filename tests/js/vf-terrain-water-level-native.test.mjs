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
  exposed = 101, submerged = 202, samplingDistance, cells, cellBudget, triangleBudget, segmentBudget, sampleIds } = {}, error) {
  const node = createConditionedRoot({ ...identity, seed });
  const stream = conditionedNodeStreamReference(node);
  const input = [...tile, level, budget, ...stream.key, ...stream.counterPrefix,
    ...[correlationLength, mean, amplitude, waterLevel].map(bits), exposed, submerged,
    ...(samplingDistance === undefined ? [] : [bits(samplingDistance)]),
    ...(sampleIds === undefined ? [] : [sampleIds.length, ...sampleIds]),
    ...(cells === undefined ? [] : [cellBudget ?? cells.length, triangleBudget ?? cells.length * 2, cells.length, ...cells]),
    ...(segmentBudget === undefined ? [] : [segmentBudget])].join(' ');
  if (cells !== undefined) assert.notEqual(samplingDistance, undefined, 'mesh test requires explicit normal sampling distance');
  if (segmentBudget !== undefined) assert.notEqual(cells, undefined, 'waterline test requires explicit cells');
  if (sampleIds !== undefined) {
    assert.notEqual(samplingDistance, undefined, 'indexed test requires explicit normal sampling distance');
  }
  const mode = sampleIds !== undefined ? (segmentBudget !== undefined ? '--indexed-waterline' : cells !== undefined ? '--indexed-triangles' : '--indexed') :
    segmentBudget !== undefined ? '--waterline' : cells !== undefined ? '--triangles' : samplingDistance === undefined ? undefined : '--normals';
  const native = spawnSync(executable, mode === undefined ? [] : [mode],
    { input, timeout: 30000, maxBuffer: 16 * 1024 * 1024 });
  if (error) {
    assert.equal(native.status, 1, `${native.error ?? ''}${native.stderr}`);
    assert.equal(native.stderr.toString(), `${error}\n`);
    assert.equal(native.stdout.length, 0, 'rejected demand published a partial terrain');
    return;
  }
  assert.equal(native.status, 0, `${native.error ?? ''}${native.stderr}`);
  const divisions = 2 ** level, width = divisions + 1;
  const count = Math.min(sampleIds === undefined ? width * width : sampleIds.length, budget);
  const stride = samplingDistance === undefined ? 28 : 52;
  let expected = Buffer.alloc(20 + count * stride);
  expected.writeBigUInt64LE(BigInt(count));
  expected.writeBigUInt64LE(BigInt(width * width), 8);
  expected.writeUInt32LE(Number(count < width * width), 16);
  for (let index = 0; index < count; ++index) {
    const sampleId = sampleIds === undefined ? index : sampleIds[index];
    const x = tile[0] + (sampleId % width) / divisions;
    const z = tile[1] + Math.floor(sampleId / width) / divisions;
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
  if (cells !== undefined) {
    const selected = Math.min(cells.length, cellBudget ?? cells.length, Math.floor((triangleBudget ?? cells.length * 2) / 2));
    const topology = [], minimum = [], maximum = [];
    const resident = sampleIds === undefined ? undefined : new Map(sampleIds.slice(0, count).map((id, index) => [id, index]));
    for (const cell of cells.slice(0, selected)) {
      const first = Math.floor(cell / divisions) * width + cell % divisions;
      const [a, b, c, d] = [first, first + 1, first + width, first + width + 1].map(id => resident === undefined ? id : resident.get(id));
      assert.ok([a, b, c, d].every(index => index !== undefined), 'oracle cell must be fully resident');
      topology.push(a, c, b, b, c, d);
      for (const vertex of [a, b, c, d])
        for (let axis = 0; axis < 3; ++axis) {
          const value = expected.readDoubleLE(20 + vertex * stride + axis * 8);
          minimum[axis] = minimum[axis] === undefined ? value : Math.min(minimum[axis], value);
          maximum[axis] = maximum[axis] === undefined ? value : Math.max(maximum[axis], value);
        }
    }
    const tail = Buffer.alloc(24 + (selected ? 48 : 0) + topology.length * 4);
    tail.writeBigUInt64LE(BigInt(selected));
    tail.writeBigUInt64LE(BigInt(selected * 2), 8);
    tail.writeUInt32LE(Number(selected < cells.length), 16);
    tail.writeUInt32LE(Number(selected > 0), 20);
    if (selected) [...minimum, ...maximum].forEach((value, i) => tail.writeDoubleLE(value, 24 + i * 8));
    topology.forEach((value, i) => tail.writeUInt32LE(value, 24 + (selected ? 48 : 0) + i * 4));
    expected = Buffer.concat([expected, tail]);
    if (segmentBudget !== undefined) {
      const segments = [], seen = new Set();
      let truncated = false;
      const position = index => [0, 1, 2].map(axis => expected.readDoubleLE(20 + index * stride + axis * 8));
      const comparePoint = (a, b) => {
        for (let axis = 0; axis < 3; ++axis) {
          if (a[axis] < b[axis]) return -1;
          if (a[axis] > b[axis]) return 1;
        }
        return 0;
      };
      const intersection = (first, second) => {
        let a = position(first), b = position(second);
        if (a[0] > b[0] || (a[0] === b[0] && a[2] > b[2])) [a, b] = [b, a];
        if (a[1] === waterLevel) return [a[0], waterLevel, a[2]];
        if (b[1] === waterLevel) return [b[0], waterLevel, b[2]];
        const t = (waterLevel - a[1]) / (b[1] - a[1]);
        return [a[0] + t * (b[0] - a[0]), waterLevel, a[2] + t * (b[2] - a[2])];
      };
      for (let i = 0; i < topology.length; i += 3) {
        const triangle = topology.slice(i, i + 3), points = [];
        for (let edge = 0; edge < 3; ++edge) {
          const first = triangle[edge], second = triangle[(edge + 1) % 3];
          if ((position(first)[1] <= waterLevel) !== (position(second)[1] <= waterLevel))
            points.push(intersection(first, second));
        }
        if (points.length !== 2 || comparePoint(points[0], points[1]) === 0) continue;
        if (comparePoint(points[1], points[0]) < 0) points.reverse();
        const key = points.flat().map(bits).join(',');
        if (seen.has(key)) continue;
        if (segments.length === segmentBudget) { truncated = true; break; }
        seen.add(key);
        segments.push(points);
      }
      const line = Buffer.alloc(12 + segments.length * 48);
      line.writeBigUInt64LE(BigInt(segments.length));
      line.writeUInt32LE(Number(truncated), 8);
      segments.forEach((segment, i) => segment.flat().forEach((value, j) => line.writeDoubleLE(value, 12 + i * 48 + j * 8)));
      expected = Buffer.concat([expected, line]);
    }
  }
  if (sampleIds !== undefined) {
    const addresses = Buffer.alloc(4 + count * 8);
    addresses.writeUInt32LE(1);
    sampleIds.slice(0, count).forEach((value, index) => addresses.writeBigUInt64LE(BigInt(value), 4 + index * 8));
    expected = Buffer.concat([expected, addresses]);
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

test('sparse distant terrain samples consume the same spatial and normal bytes', () => {
  const width = 65537, a = 60000 * width + 50000;
  run({ level: 16, budget: 4, sampleIds: [a + width + 1, a, a + width, a + 1], samplingDistance: 1 / 1024 });
});

test('addressed distant cell topology maps retained sample IDs to exact compact indices', () => {
  const width = 65537, a = 60000 * width + 50000;
  const result = run({ level: 16, budget: 4, sampleIds: [a + width + 1, a, a + width, a + 1],
    samplingDistance: 1 / 1024, cells: [60000 * 65536 + 50000] });
  const offset = 20 + 4 * 52 + 72;
  assert.deepEqual(Array.from({ length: 6 }, (_, i) => result.readUInt32LE(offset + i * 4)), [1, 2, 3, 3, 2, 0]);
});

test('addressed waterline consumes the same retained surface and level as prefix topology', () => {
  const options = { level: 3, budget: 81, samplingDistance: 1 / 1024, correlationLength: 0.125,
    cells: Array.from({ length: 64 }, (_, i) => i), segmentBudget: 128, waterLevel: 0 };
  const prefix = run(options);
  const indexed = run({ ...options, sampleIds: Array.from({ length: 81 }, (_, i) => i) });
  assert.deepEqual(indexed.subarray(0, prefix.length), prefix);
});

test('addressed topology preserves source permutations replay seeds budgets and signed-zero bounds', () => {
  const ids = Array.from({ length: 81 }, (_, i) => i), cells = Array.from({ length: 64 }, (_, i) => i);
  for (const seed of [[1, 2], [67, 89]]) {
    const options = { seed, level: 3, budget: 81, correlationLength: 0.125, samplingDistance: 1 / 1024,
      sampleIds: ids.toReversed(), cells: cells.toReversed(), segmentBudget: 128, waterLevel: 0 };
    const first = run(options);
    assert.deepEqual(run(options), first);
    for (const cellBudget of [0, 1, 7, 64])
      for (const triangleBudget of [1, 3, 128]) run({ ...options, cellBudget, triangleBudget });
    run({ ...options, sampleIds: [...ids.slice(17), ...ids.slice(0, 17)], waterLevel: 0.5 });
  }
  const options = { level: 3, budget: 81, correlationLength: 0.125, mean: -0, amplitude: 0,
    samplingDistance: 1 / 1024, sampleIds: ids.toReversed() };
  const offset = 20 + 81 * 52 + 24;
  const first = run({ ...options, cells }), reversed = run({ ...options, cells: cells.toReversed() });
  const bounds = first.subarray(offset, offset + 48);
  assert.equal(bounds.readBigUInt64LE(8), 0x8000000000000000n);
  assert.equal(bounds.readBigUInt64LE(32), 0n);
  assert.deepEqual(reversed.subarray(offset, offset + 48), bounds);
});

test('addressed selected cell diagnostics remain ordered and never publish partial output', () => {
  const width = 65537, a = 60000 * width + 50000, cell = 60000 * 65536 + 50000;
  const options = { level: 16, budget: 4, sampleIds: [a + width + 1, a, a + width, a + 1],
    samplingDistance: 1 / 1024, cells: [cell] };
  for (let missing = 0; missing < 4; ++missing)
    run({ ...options, sampleIds: options.sampleIds.filter((_, index) => index !== missing) },
      'terrain demanded cell is not fully resident');
  run({ ...options, cells: [cell, cell, 4294967296] }, 'terrain cell demand is duplicated');
  run({ ...options, cells: [4294967296, cell, cell] }, 'terrain cell demand exceeds tile domain');
  run({ ...options, cells: [cell - 1, 4294967296] }, 'terrain demanded cell is not fully resident');
  run({ ...options, cellBudget: 65537, triangleBudget: 131073 }, 'terrain cell budget must be from 0 to 65536');
  run({ ...options, triangleBudget: 131073 }, 'terrain triangle budget must be from 0 to 131072');
  run({ ...options, cells: Array(65537).fill(cell), cellBudget: 0, triangleBudget: 0 },
    'terrain cell demand must contain at most 65536 entries');
  run({ ...options, cells: [cell, cell, 4294967296], triangleBudget: 3 });
  run({ ...options, cells: [4294967296], triangleBudget: 1 });
  run({ ...options, sampleIds: [], budget: 0, cells: [4294967296], cellBudget: 0 });
});

test('full addressed topology and waterline retain exact bytes within unchanged capture limits', () => {
  const result = run({ level: 8, budget: 65536, sampleIds: Array.from({ length: 65536 }, (_, i) => 65535 - i),
    correlationLength: 1 / 256, samplingDistance: 1 / 1024, waterLevel: 0,
    cells: Array.from({ length: 65024 }, (_, i) => i), cellBudget: 65536, triangleBudget: 131072, segmentBudget: 65536 });
  assert.equal(result.length, 8638572);
  assert.equal(result.readBigUInt64LE(4968540), 65536n);
  assert.equal(result.readUInt32LE(4968548), 1);
  const width = 65537;
  run({ level: 16, budget: 4, sampleIds: [65536 * width + 65536, 65535 * width + 65535,
    65536 * width + 65535, 65535 * width + 65536], samplingDistance: 1 / 1024, cells: [4294967295] });
});

test('sparse order and replay preserve existing prefix positions normals and materials', () => {
  for (const seed of [[1, 2], [67, 89]]) {
    const options = { seed, level: 4, samplingDistance: 1 / 1024 };
    const prefix = run({ ...options, budget: 289 });
    const sampleIds = [288, 0, 17, 101];
    const sparse = run({ ...options, sampleIds, budget: 4 });
    for (let i = 0; i < sampleIds.length; ++i)
      assert.deepEqual(sparse.subarray(20 + i * 52, 20 + (i + 1) * 52),
        prefix.subarray(20 + sampleIds[i] * 52, 20 + (sampleIds[i] + 1) * 52));
    assert.deepEqual(run({ ...options, sampleIds, budget: 4 }), sparse);
    run({ ...options, sampleIds: sampleIds.toReversed(), budget: 4 });
    const moved = run({ ...options, sampleIds, budget: 4, waterLevel: -1 });
    for (let i = 0; i < sampleIds.length; ++i)
      assert.deepEqual(sparse.subarray(20 + i * 52, 20 + i * 52 + 48), moved.subarray(20 + i * 52, 20 + i * 52 + 48));
  }
});
test('full sparse demand retains 64-bit IDs without preceding or undemanded samples', () => {
  const sampleIds = Array.from({ length: 65536 }, (_, i) => (65536 - i) * 65538);
  const result = run({ level: 16, budget: 65536, sampleIds, samplingDistance: 1 / 1024 });
  assert.equal(result.length, 3932184);
  assert.equal(result.readBigUInt64LE(8), 4295098369n);
  assert.equal(result.readBigUInt64LE(20 + 65536 * 52 + 4), 4295098368n);
});
test('sparse selected addresses reject in exact order without partial output', () => {
  const options = { level: 16, samplingDistance: 1 / 1024 };
  run({ ...options, sampleIds: [0, 0, 4295098369], budget: 2 }, 'terrain sample demand is duplicated');
  run({ ...options, sampleIds: [4295098369, 0, 0], budget: 3 }, 'terrain sample demand exceeds tile domain');
  run({ ...options, sampleIds: [0, 4295098369], budget: 1 });
  run({ ...options, sampleIds: [4295098369], budget: 0 });
  run({ ...options, sampleIds: Array(65537).fill(0), budget: 0 }, 'terrain sample demand must contain at most 65536 entries');
  run({ ...options, sampleIds: [], budget: 65537 }, 'terrain sample budget must be from 0 to 65536');
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

test('bounded terrain triangulation and emitted bounds match every surface and index byte', () => {
  for (const tile of [[-1, 2], [0, 2], [-1, 3], [123, -57]]) {
    run({ tile, level: 0, budget: 4, samplingDistance: 0.015625, cells: [0] });
    for (const cells of [[7, 0, 8, 56], [56, 8, 0, 7]])
      for (const triangleBudget of [0, 1, 2, 5, 8])
        run({ tile, level: 3, budget: 81, samplingDistance: 0.015625, cells, triangleBudget });
  }
  run({ level: 4, samplingDistance: 0.015625, cells: [0, 1, 16, 17] });
});
test('mesh replay, changed seeds, and cell budget preserve exact surface truth', () => {
  const options = { level: 3, budget: 81, samplingDistance: 0.015625, cells: [0, 1, 2, 3] };
  const original = run(options);
  for (const seed of [[67, 89], [0xffffffff, 0xffffffff]])
    for (const cellBudget of [0, 1, 4]) run({ ...options, seed, cellBudget });
  assert.deepEqual(run(options), original);
  run({ level: 16, budget: 0, samplingDistance: 0.015625, cells: [0], cellBudget: 0 });
});
test('fully resident maximum mesh demand does not expand potential terrain', () => {
  const result = run({ level: 8, budget: 65536, samplingDistance: 0.015625,
    cells: Array.from({ length: 65024 }, (_, i) => i), cellBudget: 65536, triangleBudget: 131072 });
  assert.equal(result.length, 20 + 65536 * 52 + 24 + 48 + 130048 * 12);
});
test('mesh demand rejects missing corners, duplicates, and invalid limits in exact order', () => {
  const options = { level: 3, budget: 81, samplingDistance: 0.015625, cells: [0] };
  run({ ...options, budget: 10 }, 'terrain demanded cell is not fully resident');
  run({ ...options, level: 16, budget: 65536 }, 'terrain demanded cell is not fully resident');
  run({ ...options, cells: [64] }, 'terrain cell demand exceeds tile domain');
  run({ ...options, cells: [0, 0, 64] }, 'terrain cell demand is duplicated');
  run({ ...options, cells: [64, 0, 0] }, 'terrain cell demand exceeds tile domain');
  run({ ...options, cellBudget: 65537, triangleBudget: 131073 }, 'terrain cell budget must be from 0 to 65536');
  run({ ...options, triangleBudget: 131073 }, 'terrain triangle budget must be from 0 to 131072');
  run({ ...options, cells: Array(65537).fill(0), cellBudget: 0, triangleBudget: 0 },
    'terrain cell demand must contain at most 65536 entries');
  run({ ...options, cells: [0, 0, 64], cellBudget: 1 });
  run({ ...options, cells: [64], cellBudget: 0 });
});

test('mixed signed-zero mesh bounds are byte-identical under cell permutations', () => {
  const order = Array.from({ length: 64 }, (_, i) => i);
  const options = { level: 3, budget: 81, correlationLength: 0.125, mean: -0,
    amplitude: 0, samplingDistance: 0.015625 };
  const boundsOffset = 20 + 81 * 52 + 24;
  const outputs = [order, order.toReversed(), [...order.slice(17), ...order.slice(0, 17)]]
    .map(cells => run({ ...options, cells }));
  const bounds = outputs[0].subarray(boundsOffset, boundsOffset + 48);
  assert.equal(bounds.readBigUInt64LE(8), 0x8000000000000000n, 'minimum Y must retain negative zero');
  assert.equal(bounds.readBigUInt64LE(32), 0n, 'maximum Y must retain positive zero');
  for (const output of outputs.slice(1))
    assert.deepEqual(output.subarray(boundsOffset, boundsOffset + 48), bounds);
});

test('waterlines consume complete emitted surface bytes and their retained level exactly', () => {
  const cells = Array.from({ length: 64 }, (_, i) => i);
  for (const seed of [[1, 2], [67, 89]])
    for (const waterLevel of [-0.5, 0, 0.5])
      for (const segmentBudget of [0, 1, 8, 128])
        run({ level: 3, budget: 81, correlationLength: 0.125, samplingDistance: 0.015625,
          seed, waterLevel, cells, segmentBudget });
});
test('waterline replay and changed level preserve geometry and canonical interpolation', () => {
  const options = { level: 3, budget: 81, correlationLength: 0.125, samplingDistance: 0.015625,
    cells: Array.from({ length: 64 }, (_, i) => i), segmentBudget: 128 };
  const first = run({ ...options, waterLevel: 0 });
  run({ ...options, cells: options.cells.toReversed(), waterLevel: 0 });
  const moved = run({ ...options, waterLevel: 0.5 });
  assert.deepEqual(run({ ...options, waterLevel: 0 }), first);
  for (let i = 0; i < 81; ++i)
    assert.deepEqual(first.subarray(20 + i * 52, 20 + i * 52 + 48), moved.subarray(20 + i * 52, 20 + i * 52 + 48));
  assert.notDeepEqual(first, moved);
});
test('waterline full demand preserves the unchanged capture and segment limits', () => {
  const result = run({ level: 8, budget: 65536, correlationLength: 1 / 256, samplingDistance: 1 / 1024,
    waterLevel: 0, cells: Array.from({ length: 65024 }, (_, i) => i),
    cellBudget: 65536, triangleBudget: 131072, segmentBudget: 65536 });
  assert.equal(result.length, 8114280);
  assert.equal(result.readBigUInt64LE(4968540), 65536n);
  assert.equal(result.readUInt32LE(4968548), 1);
});
test('waterline coplanar and point-only contacts emit no separator', () => {
  const cells = Array.from({ length: 64 }, (_, i) => i);
  const options = { level: 3, budget: 81, correlationLength: 0.125, samplingDistance: 0.015625, cells, segmentBudget: 128 };
  const flat = run({ ...options, mean: -0, amplitude: 0, waterLevel: -0 });
  assert.equal(flat.readBigUInt64LE(flat.length - 12), 0n);
  const node = createConditionedRoot(identity);
  const heights = Array.from({ length: 81 }, (_, i) => sampleSpatialCorrelation2Reference(node,
    [-1 + (i % 9) / 8, 2 + Math.floor(i / 9) / 8], { correlationLength: 0.125, mean: 0, amplitude: 2 }));
  const minimum = Math.min(...heights);
  assert.equal(heights.filter(h => h === minimum).length, 1, 'fixture must have one point-only minimum');
  const touch = run({ ...options, waterLevel: minimum });
  assert.equal(touch.readBigUInt64LE(touch.length - 12), 0n);
  run({ ...options, segmentBudget: 65537 }, 'terrain waterline segment budget must be from 0 to 65536');
});
