import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createCoarseEllipsoidReference,
} from '../../web/vf-ui/vf-demand-refined-geometry.mjs';
import {
  updateEllipsoidRefinementWorkingSetReference,
} from '../../web/vf-ui/vf-refinement-working-set.mjs';

const demand = (
  face,
  {
    silhouette = false,
    silhouetteErrorPixels = 0,
    projectedErrorPixels = 0,
    errorBoundPixels = projectedErrorPixels,
  } = {},
) => Object.freeze({
  face,
  silhouette,
  silhouetteEdges: Object.freeze([]),
  silhouetteErrorPixels,
  projectedErrorPixels,
  errorBoundPixels,
});

test('working set retains only highest-priority detail within both budgets', () => {
  const coarse = createCoarseEllipsoidReference({ radii: [3, 2, 1.5] });
  const demands = [
    demand('face:+x:+y:+z', { projectedErrorPixels: 100 }),
    demand('face:+x:+y:-z', {
      silhouette: true,
      silhouetteErrorPixels: 20,
      projectedErrorPixels: 20,
    }),
    demand('face:+x:-y:+z', {
      silhouette: true,
      silhouetteErrorPixels: 40,
      projectedErrorPixels: 40,
    }),
    demand('face:+x:-y:-z', { projectedErrorPixels: 200 }),
  ];
  const state = updateEllipsoidRefinementWorkingSetReference(coarse, null, {
    demands,
    vertexBudget: 2,
    faceBudget: 6,
  });

  assert.strictEqual(state.coarse, coarse);
  assert.deepEqual(state.entries.map(({ face }) => face), [
    'face:+x:-y:+z',
    'face:+x:+y:-z',
  ]);
  assert.deepEqual(state.usage, { vertices: 2, faces: 6 });
  assert.ok(state.usage.vertices <= state.budget.vertices);
  assert.ok(state.usage.faces <= state.budget.faces);
  assert.ok(state.entries.every(({ vertices, faces }) => (
    vertices.length === 1 && faces.length === 3
  )));
  assert.deepEqual(state.changes, {
    retained: [],
    created: ['face:+x:-y:+z', 'face:+x:+y:-z'],
    evicted: [],
  });
  assert.ok(Object.isFrozen(state));
  assert.ok(Object.isFrozen(state.entries));
});

test('unchanged active demand reaches a retained steady state', () => {
  const coarse = createCoarseEllipsoidReference({ radii: [3, 2, 1.5] });
  const demands = [
    demand('face:+x:+y:+z', {
      silhouette: true,
      silhouetteErrorPixels: 40,
      projectedErrorPixels: 40,
    }),
    demand('face:+x:+y:-z', {
      silhouette: true,
      silhouetteErrorPixels: 20,
      projectedErrorPixels: 20,
    }),
  ];
  const options = { demands, vertexBudget: 2, faceBudget: 6 };
  const first = updateEllipsoidRefinementWorkingSetReference(coarse, null, options);
  const second = updateEllipsoidRefinementWorkingSetReference(coarse, first, options);

  assert.strictEqual(second.coarse, coarse);
  assert.strictEqual(second.entries[0], first.entries[0]);
  assert.strictEqual(second.entries[1], first.entries[1]);
  assert.deepEqual(second.usage, first.usage);
  assert.deepEqual(second.changes, {
    retained: ['face:+x:+y:+z', 'face:+x:+y:-z'],
    created: [],
    evicted: [],
  });
});

test('camera changes evict stale detail and regenerate it exactly from face keys', () => {
  const coarse = createCoarseEllipsoidReference({ radii: [3, 2, 1.5] });
  const coarseVertices = coarse.vertices;
  const coarseFaces = coarse.faces;
  const firstDemands = [
    demand('face:+x:+y:+z', { projectedErrorPixels: 40 }),
    demand('face:+x:+y:-z', { projectedErrorPixels: 20 }),
  ];
  const secondDemands = [
    demand('face:-x:-y:+z', { projectedErrorPixels: 70 }),
    demand('face:-x:+y:+z', { projectedErrorPixels: 50 }),
  ];
  const update = (previous, demands) => (
    updateEllipsoidRefinementWorkingSetReference(coarse, previous, {
      demands,
      vertexBudget: 2,
      faceBudget: 6,
    })
  );
  const first = update(null, firstDemands);
  const changed = update(first, secondDemands);
  const regenerated = update(changed, [...firstDemands].reverse());

  assert.deepEqual(changed.entries.map(({ face }) => face), [
    'face:-x:-y:+z',
    'face:-x:+y:+z',
  ]);
  assert.deepEqual(changed.changes, {
    retained: [],
    created: ['face:-x:-y:+z', 'face:-x:+y:+z'],
    evicted: ['face:+x:+y:+z', 'face:+x:+y:-z'],
  });
  assert.deepEqual(regenerated.entries, first.entries);
  assert.notStrictEqual(regenerated.entries[0], first.entries[0]);
  assert.notStrictEqual(regenerated.entries[1], first.entries[1]);
  assert.deepEqual(regenerated.changes, {
    retained: [],
    created: ['face:+x:+y:+z', 'face:+x:+y:-z'],
    evicted: ['face:-x:-y:+z', 'face:-x:+y:+z'],
  });
  assert.strictEqual(regenerated.coarse, coarse);
  assert.strictEqual(coarse.vertices, coarseVertices);
  assert.strictEqual(coarse.faces, coarseFaces);
});

test('working-set selection is traversal and chunk independent', () => {
  const coarse = createCoarseEllipsoidReference({ radii: [3, 2, 1.5] });
  const demands = [
    demand('face:+x:+y:+z', { projectedErrorPixels: 100 }),
    demand('face:+x:+y:-z', {
      silhouette: true,
      silhouetteErrorPixels: 20,
      projectedErrorPixels: 20,
    }),
    demand('face:+x:-y:+z', {
      silhouette: true,
      silhouetteErrorPixels: 40,
      projectedErrorPixels: 40,
    }),
    demand('face:+x:-y:-z', { projectedErrorPixels: 200 }),
  ];
  const update = (active) => updateEllipsoidRefinementWorkingSetReference(
    coarse,
    null,
    { demands: active, vertexBudget: 3, faceBudget: 9 },
  );
  const forward = update(demands);
  const reversed = update([...demands].reverse());
  const chunks = [demands.slice(0, 1), demands.slice(1, 3), demands.slice(3)];
  const chunked = update(chunks.flat());

  assert.deepEqual(reversed, forward);
  assert.deepEqual(chunked, forward);
  assert.throws(() => update([demands[0], demands[0]]), RangeError);
  assert.throws(
    () => update([demand('face:missing', { projectedErrorPixels: 1 })]),
    RangeError,
  );
});
