import assert from 'node:assert/strict';
import test from 'node:test';

import {
  clusterReflectionFacets,
  scheduleReflectionCaptures
} from '../../web/vf-ui/geom/vf-reflection-planner.mjs';

function tile(id, x, y, overrides = {}) {
  return {
    id,
    plane: { normal: [0, 0, 1], offset: 0 },
    neighbors: [],
    projectedPixels: 64,
    visible: true,
    frontFacing: true,
    bounds: { min: [x, y, 0], max: [x + 1, y + 1, 0] },
    ...overrides
  };
}

function tiledMirror(width, height) {
  const facets = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const id = `tile-${y * width + x}`;
      const neighbors = [];
      if (x > 0) neighbors.push(`tile-${y * width + x - 1}`);
      if (x + 1 < width) neighbors.push(`tile-${y * width + x + 1}`);
      if (y > 0) neighbors.push(`tile-${(y - 1) * width + x}`);
      if (y + 1 < height) neighbors.push(`tile-${(y + 1) * width + x}`);
      facets.push(tile(id, x, y, { neighbors }));
    }
  }
  return facets;
}

test('collapses 4,096 connected coplanar mirror tiles into one exact cluster', () => {
  const clusters = clusterReflectionFacets(tiledMirror(64, 64));

  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].facetIds.length, 4096);
  assert.equal(clusters[0].exact, true);
});

test('keeps disconnected and tilted mirror facets in distinct clusters', () => {
  const facets = tiledMirror(2, 1);
  facets.push(tile('disconnected', 4, 0));
  facets.push(tile('tilted', 2, 0, {
    neighbors: ['tile-1'],
    plane: { normal: [0, Math.SQRT1_2, Math.SQRT1_2], offset: 0 }
  }));
  facets[1].neighbors.push('tilted');

  const clusters = clusterReflectionFacets(facets);

  assert.equal(clusters.length, 3);
  assert.deepEqual(clusters.map(cluster => cluster.facetIds), [
    ['disconnected'],
    ['tile-0', 'tile-1'],
    ['tilted']
  ]);
});

test('produces the same stable cluster IDs after input order changes', () => {
  const facets = tiledMirror(8, 4);
  facets.push(tile('island', 20, 20));
  const shuffled = facets.slice().sort((left, right) => right.id.localeCompare(left.id));

  assert.deepEqual(
    clusterReflectionFacets(shuffled).map(cluster => cluster.id),
    clusterReflectionFacets(facets).map(cluster => cluster.id)
  );
});

test('schedules only visible captures within declared capture and pixel budgets', () => {
  const facets = [
    tile('large', 0, 0, { projectedPixels: 900 }),
    tile('medium', 2, 0, { projectedPixels: 500 }),
    tile('small', 4, 0, { projectedPixels: 100 }),
    tile('culled', 6, 0, { projectedPixels: 10000, visible: false }),
    tile('backface', 8, 0, { projectedPixels: 10000, frontFacing: false })
  ];

  const plan = scheduleReflectionCaptures(clusterReflectionFacets(facets), {
    maxCaptures: 2,
    maxPixels: 1000
  });

  assert.equal(plan.jobs.length, 2);
  assert.deepEqual(plan.jobs.map(job => job.facetIds[0]), ['large', 'medium']);
  assert.equal(plan.jobs.reduce((sum, job) => sum + job.allocatedPixels, 0), 1000);
  assert.equal(plan.jobs.some(job => job.facetIds.includes('culled')), false);
  assert.equal(plan.jobs.some(job => job.facetIds.includes('backface')), false);
  assert.deepEqual(plan.budget, { maxCaptures: 2, maxPixels: 1000 });
});
