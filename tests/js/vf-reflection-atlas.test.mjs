import assert from 'node:assert/strict';
import test from 'node:test';

import { allocateReflectionAtlas } from '../../web/vf-ui/geom/vf-reflection-atlas.mjs';

function job(clusterId, allocatedPixels, cacheKey = `${clusterId}@scene-1`) {
  return { clusterId, allocatedPixels, cacheKey, facetIds: [clusterId], exact: true };
}

test('allocates deterministic bounded atlas slots', () => {
  const atlas = allocateReflectionAtlas([
    job('large', 600),
    job('medium', 400)
  ], { maxCaptures: 2, maxPixels: 1000 });

  assert.deepEqual(atlas.assignments.map(item => [item.clusterId, item.slotId, item.status]), [
    ['large', 'reflection-atlas-slot-0', 'capture'],
    ['medium', 'reflection-atlas-slot-1', 'capture']
  ]);
  assert.deepEqual(atlas.stats, {
    allocatedCaptures: 2,
    allocatedPixels: 1000,
    reusedCaptures: 0,
    invalidatedCaptures: 0,
    newCaptures: 2,
    overflowCount: 0
  });
});

test('preserves slots and reuses valid captures when job order changes', () => {
  const first = allocateReflectionAtlas([
    job('alpha', 320),
    job('beta', 240)
  ], { maxCaptures: 2, maxPixels: 600 });
  const second = allocateReflectionAtlas([
    job('beta', 240),
    job('alpha', 320)
  ], { previous: first, maxCaptures: 2, maxPixels: 600 });

  assert.deepEqual(second.assignments.map(item => [item.clusterId, item.slotId, item.status]), [
    ['beta', 'reflection-atlas-slot-1', 'reused'],
    ['alpha', 'reflection-atlas-slot-0', 'reused']
  ]);
  assert.equal(second.stats.reusedCaptures, 2);
  assert.equal(second.assignments.every(item => item.needsCapture === false), true);
});

test('keeps a stable slot but invalidates changed capture content or size', () => {
  const first = allocateReflectionAtlas([
    job('mirror', 256, 'mirror@scene-1')
  ], { maxCaptures: 1, maxPixels: 512 });

  const changedScene = allocateReflectionAtlas([
    job('mirror', 256, 'mirror@scene-2')
  ], { previous: first, maxCaptures: 1, maxPixels: 512 });
  assert.deepEqual(changedScene.assignments[0], {
    clusterId: 'mirror',
    slotId: 'reflection-atlas-slot-0',
    allocatedPixels: 256,
    cacheKey: 'mirror@scene-2',
    status: 'invalidated',
    needsCapture: true
  });

  const changedSize = allocateReflectionAtlas([
    job('mirror', 384, 'mirror@scene-2')
  ], { previous: changedScene, maxCaptures: 1, maxPixels: 512 });
  assert.equal(changedSize.assignments[0].slotId, 'reflection-atlas-slot-0');
  assert.equal(changedSize.assignments[0].status, 'invalidated');
});

test('reports graceful deterministic overflow while filling usable capacity', () => {
  const atlas = allocateReflectionAtlas([
    job('large', 600),
    job('too-wide', 500),
    job('fits', 400),
    job('after-capture-limit', 1)
  ], { maxCaptures: 2, maxPixels: 1000 });

  assert.deepEqual(atlas.assignments.map(item => item.clusterId), ['large', 'fits']);
  assert.equal(atlas.stats.allocatedPixels, 1000);
  assert.deepEqual(atlas.overflow, [
    { clusterId: 'too-wide', requestedPixels: 500, reason: 'pixel-budget' },
    { clusterId: 'after-capture-limit', requestedPixels: 1, reason: 'capture-budget' }
  ]);
});

test('bounds 4,096 faceted captures by the interactive atlas contract', () => {
  const jobs = Array.from({ length: 4096 }, (_, index) => job(`facet-${index}`, 524288));
  const atlas = allocateReflectionAtlas(jobs, {
    maxCaptures: 32,
    maxPixels: 16777216
  });

  assert.equal(atlas.stats.allocatedCaptures, 32);
  assert.equal(atlas.stats.allocatedPixels, 16777216);
  assert.equal(atlas.overflow.length, 4064);
  assert.equal(atlas.overflow.every(item => item.reason === 'capture-budget'), true);
});
