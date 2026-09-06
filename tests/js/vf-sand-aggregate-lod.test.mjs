import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  createDrySandHopperReference,
  stepDrySandHopperReference,
} from '../../web/vf-ui/vf-sand-hopper-reference.mjs';
import {
  createDrySandAggregateReference,
  createDrySandAggregateRenderPacketReference,
  settleDrySandIntoAggregateReference,
  stepDrySandBcreReference,
} from '../../web/vf-ui/vf-sand-aggregate-reference.mjs';

const hash = (view) => createHash('sha256')
  .update(Buffer.from(view.buffer, view.byteOffset, view.byteLength)).digest('hex');

function realizedWorld(seed = 0x62a1) {
  const world = createDrySandHopperReference({
    seed, grainCount: 320, outletDiameterInGrains: 4.5, fillHeightInGrains: 18,
  });
  stepDrySandHopperReference(world, 560);
  return world;
}

test('settled explicit grains transfer once into one conservative dense state', () => {
  const world = realizedWorld();
  const aggregate = createDrySandAggregateReference(world, { resolution: 33, extent: 1.4 });
  const first = settleDrySandIntoAggregateReference(world, aggregate, { speedThreshold: 0.08 });
  const second = settleDrySandIntoAggregateReference(world, aggregate, { speedThreshold: 0.08 });
  assert.ok(first.transferredCount > 32);
  assert.equal(second.transferredCount, 0);
  assert.equal(first.explicitCount + aggregate.grainEquivalentCount, world.count);
  assert.ok(Math.abs(aggregate.totalMass - aggregate.grainEquivalentCount * aggregate.grainMass) < 1e-12);
  assert.equal(world.render.aggregate, aggregate);
  assert.equal(world.state.aggregated.length, world.count);
});

test('aggregate replay is byte exact and a different geology identity varies glints', () => {
  const realize = (seed) => {
    const world = realizedWorld(seed);
    const aggregate = createDrySandAggregateReference(world, { resolution: 33, extent: 1.4 });
    settleDrySandIntoAggregateReference(world, aggregate, { speedThreshold: 0.08 });
    return aggregate;
  };
  const first = realize(0x62a1);
  const replay = realize(0x62a1);
  const varied = realize(0x62a2);
  assert.equal(hash(first.heights), hash(replay.heights));
  assert.equal(hash(first.rollingMass), hash(replay.rollingMass));
  assert.equal(hash(first.glint), hash(replay.glint));
  assert.notEqual(hash(first.glint), hash(varied.glint));
});

test('fixed-step BCRE transport conserves mass and relaxes super-repose slopes', () => {
  const world = realizedWorld();
  const aggregate = createDrySandAggregateReference(world, { resolution: 33, extent: 1.4 });
  settleDrySandIntoAggregateReference(world, aggregate, { speedThreshold: 0.08 });
  aggregate.heights[16 * 33 + 16] += world.diameter * 8;
  stepDrySandBcreReference(aggregate, 0);
  const beforeMass = aggregate.totalMass;
  const beforeSlope = aggregate.maximumSlopeDegrees;
  stepDrySandBcreReference(aggregate, 240);
  assert.ok(Math.abs(aggregate.totalMass - beforeMass) < aggregate.grainMass * 1e-6);
  assert.ok(aggregate.maximumSlopeDegrees < beforeSlope);
  assert.ok(aggregate.maximumSlopeDegrees <= aggregate.reposeAngleDegrees + 1.5);
  assert.ok(aggregate.rollingMass.every((value) => Number.isFinite(value) && value >= 0));
});

test('mid/far packets are lower-detail views of the same aggregate revision', () => {
  const world = realizedWorld();
  const aggregate = createDrySandAggregateReference(world, { resolution: 33, extent: 1.4 });
  settleDrySandIntoAggregateReference(world, aggregate, { speedThreshold: 0.08 });
  const near = createDrySandAggregateRenderPacketReference(aggregate, { distance: 2 });
  const mid = createDrySandAggregateRenderPacketReference(aggregate, { distance: 9 });
  const far = createDrySandAggregateRenderPacketReference(aggregate, { distance: 24 });
  assert.deepEqual([near.lod, mid.lod, far.lod], ['near', 'mid', 'far']);
  assert.equal(near.sourceRevision, mid.sourceRevision);
  assert.equal(mid.sourceRevision, far.sourceRevision);
  assert.ok(near.vertices.length > mid.vertices.length && mid.vertices.length > far.vertices.length);
  assert.ok(near.indices.length > mid.indices.length && mid.indices.length > far.indices.length);
  for (const packet of [near, mid, far]) {
    assert.equal(packet.sand_aggregate_gpu.kind, 'sand-aggregate-material:v1');
    assert.equal(packet.sand_aggregate_gpu.heightHash, aggregate.heightHash);
    assert.ok(packet.vertices.every(Number.isFinite));
    assert.ok(packet.indices.every((index) => index < packet.vertices.length / 10));
  }
});

test('aggregate normal, specular, and glint channels come from height/material state', () => {
  const world = realizedWorld();
  const aggregate = createDrySandAggregateReference(world, { resolution: 33, extent: 1.4 });
  settleDrySandIntoAggregateReference(world, aggregate, { speedThreshold: 0.08 });
  const packet = createDrySandAggregateRenderPacketReference(aggregate, { distance: 12 });
  assert.ok(packet.sand_aggregate_gpu.normalStrength > 0);
  assert.ok(packet.sand_aggregate_gpu.roughness >= 0.72);
  assert.ok(packet.sand_aggregate_gpu.glintDensity > 0);
  assert.ok(new Set([...aggregate.glint].map((value) => value.toFixed(4))).size > 16);
  assert.ok(packet.vertices.some((value, index) => index % 10 >= 3 && index % 10 <= 5 && value !== 0));
  assert.equal(packet.static_vertices, false);
});
