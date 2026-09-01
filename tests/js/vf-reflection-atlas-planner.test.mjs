import assert from 'node:assert/strict';
import test from 'node:test';

import { planReflectionAtlas } from '../../web/vf-ui/geom/vf-reflection-planner.mjs';

function cluster(id, projectedPixels) {
  return {
    id,
    exact: true,
    facetIds: [`${id}-facet`],
    schedulableFacetIds: [`${id}-facet`],
    projectedPixels
  };
}

test('feeds deterministic planner jobs into the shared atlas cache', () => {
  const clusters = [cluster('small', 100), cluster('large', 600), cluster('medium', 400)];
  const first = planReflectionAtlas(clusters, {
    maxCaptures: 2,
    maxPixels: 1000,
    captureRevision: 'camera-1/scene-1'
  });

  assert.deepEqual(first.capturePlan.jobs.map(job => job.clusterId), ['large', 'medium']);
  assert.deepEqual(first.atlas.assignments.map(item => [item.clusterId, item.slotId, item.status]), [
    ['large', 'reflection-atlas-slot-0', 'capture'],
    ['medium', 'reflection-atlas-slot-1', 'capture']
  ]);

  const second = planReflectionAtlas(clusters.slice().reverse(), {
    maxCaptures: 2,
    maxPixels: 1000,
    captureRevision: 'camera-1/scene-1',
    previousAtlas: first.atlas
  });
  assert.deepEqual(second.atlas.assignments.map(item => [item.clusterId, item.slotId, item.status]), [
    ['large', 'reflection-atlas-slot-0', 'reused'],
    ['medium', 'reflection-atlas-slot-1', 'reused']
  ]);
});

test('requires capture provenance and invalidates reuse when it changes', () => {
  const clusters = [cluster('mirror', 256)];
  assert.throws(
    () => planReflectionAtlas(clusters, { maxCaptures: 1, maxPixels: 256 }),
    /captureRevision must be non-empty/
  );

  const first = planReflectionAtlas(clusters, {
    maxCaptures: 1,
    maxPixels: 256,
    captureRevision: 'camera-1/scene-1'
  });
  const changed = planReflectionAtlas(clusters, {
    maxCaptures: 1,
    maxPixels: 256,
    captureRevision: 'camera-2/scene-1',
    previousAtlas: first.atlas
  });

  assert.equal(changed.atlas.assignments[0].slotId, 'reflection-atlas-slot-0');
  assert.equal(changed.atlas.assignments[0].status, 'invalidated');
  assert.equal(changed.atlas.assignments[0].needsCapture, true);
});
