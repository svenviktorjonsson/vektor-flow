import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import test from 'node:test';
import { conditionChild, conditionedNodeStreamReference, createConditionedRoot } from '../../web/vf-ui/vf-conditioned-distribution.mjs';
import { createRoadCoordinateFieldReference, realizeRoadCoordinateCellsReference } from '../../web/vf-ui/vf-road-coordinate-field.mjs';
import { createRoadWearFieldReference, realizeRoadWearCellsReference } from '../../web/vf-ui/vf-road-wear-field.mjs';
import { createRoadWaterFieldReference, realizeRoadWaterCellsReference } from '../../web/vf-ui/vf-road-water-field.mjs';

const identity = { generator: 'vkf.conditioned', version: 1,
  seed: [0x6a09e667, 0xbb67ae85], domain: 'material',
  hierarchy: ['world:test', 'road:arterial-7'], lod: 0, channel: 'road-water' };
const executable = process.env.VKF_ROAD_WATER_PROBE ?? resolve('build/road-water/native-probe');
if (!process.env.VKF_ROAD_WATER_PROBE) {
  mkdirSync('build/road-water', { recursive: true });
  const built = spawnSync(process.env.CXX ?? 'g++', ['-std=c++20', '-O2', '-ffp-contract=off',
    '-Wall', '-Wextra', '-Werror', '-pedantic', '-I.', 'tools/road-water-native-probe.cpp', '-o', executable], { encoding: 'utf8' });
  assert.equal(built.status, 0, `${built.error ?? ''}${built.stdout}${built.stderr}`);
}
function wearFor(cells) {
  const coordinates = realizeRoadCoordinateCellsReference(createRoadCoordinateFieldReference({
    origin: [10, 20, 3], forward: [1, 0, 0], up: [0, 0, 1], cellSize: [1, 0.1],
    longitudinalCells: 1_000_000_000, lateralCells: 100, layerThicknesses: [1, 2, 4],
  }), { cells, cellBudget: cells.length });
  return realizeRoadWearCellsReference(createRoadWearFieldReference({ ...identity, channel: 'road-wear' }),
    coordinates, { sampleBudget: cells.length });
}
const bits = array => [...new Uint32Array(array.buffer, array.byteOffset, array.length)];
function compare(wear, sampleBudget, waterIdentity = identity, nativeWear = false,
  wearIdentity = { ...identity, channel: 'road-wear' }) {
  const stream = conditionedNodeStreamReference(conditionChild(createConditionedRoot(waterIdentity),
    { segment: 'road-field:water-pooling', channel: 'standing-water' }));
  const wearStreams = ['traffic', 'exposure'].flatMap(kind => {
    const child = conditionedNodeStreamReference(conditionChild(createConditionedRoot(wearIdentity),
      { segment: `road-field:${kind}`, channel: kind === 'traffic' ? 'traffic-load' : 'weather-exposure' }));
    return [...child.key, ...child.counterPrefix];
  });
  const input = [wear.sampleCount, sampleBudget, wear.potentialCellCount, ...stream.key, ...stream.counterPrefix,
    ...(nativeWear ? wearStreams : []),
    ...bits(wear.geometry.coordinates), ...bits(wear.geometry.positions), ...wear.geometry.layerIndices,
    ...(nativeWear ? [] : [...bits(wear.drivers), ...bits(wear.material.albedo), ...bits(wear.material.roughness), ...bits(wear.material.wetness)])].join(' ');
  const native = spawnSync(executable, nativeWear ? ['--native-wear'] : [], { input, encoding: 'utf8', timeout: 30000, maxBuffer: 16 * 1024 * 1024 });
  let result;
  let producedWear;
  try {
    if (nativeWear) {
      const geometry = { coordinates: wear.geometry.coordinates, positions: wear.geometry.positions, layerIndices: wear.geometry.layerIndices };
      producedWear = realizeRoadWearCellsReference(createRoadWearFieldReference(wearIdentity),
        { kind: 'road-coordinate-working-set:v1', cellCount: wear.sampleCount, potentialCellCount: wear.potentialCellCount, geometry, material: geometry }, { sampleBudget });
      wear = producedWear;
    }
    result = realizeRoadWaterCellsReference(createRoadWaterFieldReference(waterIdentity), wear, { sampleBudget });
  } catch (error) {
    assert.equal(native.status, 1, `${native.error ?? ''}${native.stdout}${native.stderr}`);
    assert.equal(native.stderr, `${error.message}\n`);
    return;
  }
  assert.equal(native.status, 0, `${native.error ?? ''}${native.stderr}`);
  const expected = [...(producedWear ? [producedWear.sampleCount, producedWear.vectorBytes, Number(producedWear.truncated),
    ...bits(producedWear.drivers), ...bits(producedWear.geometry.displacement), ...bits(producedWear.material.albedo),
    ...bits(producedWear.material.roughness), ...bits(producedWear.material.wetness)] : []),
    result.sampleCount, result.vectorBytes, Number(result.truncated),
    ...bits(result.poolingDriver), ...bits(result.geometry.waterCoverage), ...bits(result.geometry.waterDepth),
    ...bits(result.material.albedo), ...bits(result.material.roughness), ...bits(result.material.wetness)];
  assert.deepEqual(native.stdout.trim().split(/\s+/).map(Number), expected);
  return result;
}
test('native standing water consumes the existing bounded wet/dry road fixture bit-for-bit', () => {
  const wear = wearFor([[0, 49, 0], [0, 5, 0], [1, 94, 0], [0, 5, 1], [10, 5, 0]]);
  const result = compare(wear, 4);
  assert.equal(result.geometry.waterDepth[0], 0.004998494870960712);
  assert.deepEqual([...result.geometry.waterCoverage].slice(1), [0, 0, 0]);
});
test('native water preserves reference NaN propagation instead of repairing wear values', () => {
  const wear = wearFor([[0, 49, 0]]);
  wear.drivers[0] = NaN;
  compare(wear, 1);
});
test('native water reproduces changed identities, reordered demand, and bounded prefixes', () => {
  const cells = Array.from({ length: 1024 }, (_, index) => [index * 19, index % 100, index % 3]);
  for (const ordered of [cells, cells.toReversed()]) {
    const wear = wearFor(ordered);
    for (const budget of [0, 1, 101, 1024]) compare(wear, budget);
    compare(wear, 1024, { ...identity, seed: [0x12345678, 0xffffffff], hierarchy: ['world:other', 'road:2'] });
  }
  compare(wearFor([]), 0);
});
test('native water preserves exact validation order and spatial-domain diagnostics', () => {
  const wear = wearFor([[0, 49, 0], [1, 49, 0]]);
  compare(wear, 65537);
  wear.geometry.coordinates[0] = NaN;
  compare(wear, 65537); // Budget is validated before demanded spatial samples.
  compare(wear, 0); // Undemanded samples are not evaluated.
  compare(wear, 1);
  wear.geometry.coordinates[0] = 0;
  wear.geometry.coordinates[1] = Infinity;
  compare(wear, 1);
  wear.geometry.coordinates[1] = 0;
  wear.geometry.coordinates[0] = 2 ** 40;
  compare(wear, 1);
});
test('native water keeps signed positions, extreme wear, and saturated drainage exact', () => {
  const wear = wearFor(Array.from({ length: 101 }, (_, i) => [i, i % 100, i % 3]));
  for (let i = 0; i < wear.sampleCount; ++i) {
    wear.geometry.coordinates[i * 3] = (i - 50) * 123.25;
    wear.geometry.coordinates[i * 3 + 1] = (i - 50) / 10;
    wear.drivers[i * 2] = i % 2 ? -Infinity : Infinity;
    wear.drivers[i * 2 + 1] = (i - 50) * 10;
  }
  compare(wear, 101);
});
test('native water honors the full existing 65536-sample budget without expanding the potential road', () => {
  const wear = wearFor(Array.from({ length: 65536 }, (_, i) => [i * 13, i % 100, i % 3]));
  const result = compare(wear, 65536);
  assert.equal(result.vectorBytes, 65536 * 32);
  assert.equal(result.potentialCellCount, 300_000_000_000);
  assert.equal(result.truncated, false);
});
test('native wear drives native standing water without precomputed wear samples', () => {
  const wear = wearFor([[0, 49, 0], [0, 5, 0], [1, 94, 0], [0, 5, 1], [10, 5, 0]]);
  compare(wear, 4, identity, true);
});
test('native wear-to-water preserves changed conditioning, reorder, and truncated prefixes', () => {
  const cells = Array.from({ length: 1024 }, (_, i) => [i * 101, i % 100, i % 3]);
  for (const order of [cells, cells.toReversed()]) {
    const wear = wearFor(order);
    for (const budget of [0, 1, 101, 1024]) compare(wear, budget, identity, true);
    compare(wear, 1024, identity, true, { ...identity, seed: [1, 2], hierarchy: ['world:another', 'road:wet'], channel: 'road-wear' });
  }
});
test('native wear rejects malformed coordinates and budgets in the reference order', () => {
  const wear = wearFor([[0, 49, 0]]);
  compare(wear, 65537, identity, true);
  wear.geometry.coordinates[0] = NaN;
  compare(wear, 65537, identity, true);
  compare(wear, 0, identity, true);
  compare(wear, 1, identity, true);
  wear.geometry.coordinates[0] = 0;
  wear.geometry.coordinates[1] = Infinity;
  compare(wear, 1, identity, true);
  wear.geometry.coordinates[1] = 0;
  wear.geometry.coordinates[0] = -(2 ** 40);
  compare(wear, 1, identity, true);
});
test('full native wear-to-water chain stays exact at maximum demand', () => {
  compare(wearFor(Array.from({ length: 65536 }, (_, i) => [i * 13, i % 100, i % 3])), 65536, identity, true);
});
