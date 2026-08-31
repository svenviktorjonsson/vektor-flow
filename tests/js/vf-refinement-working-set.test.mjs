import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createCoarseEllipsoidReference,
} from '../../web/vf-ui/vf-demand-refined-geometry.mjs';
import {
  selectEllipsoidViewDemandReference,
} from '../../web/vf-ui/vf-ellipsoid-view-demand.mjs';
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

test('working set rejects invalid budgets, priorities, and predecessor state', () => {
  const coarse = createCoarseEllipsoidReference({ radii: [3, 2, 1.5] });
  const valid = demand('face:+x:+y:+z', { projectedErrorPixels: 10 });
  const update = (
    overrides = {},
    previous = null,
    candidateCoarse = coarse,
  ) => updateEllipsoidRefinementWorkingSetReference(candidateCoarse, previous, {
    demands: [valid],
    vertexBudget: 1,
    faceBudget: 3,
    ...overrides,
  });

  assert.throws(() => update({ vertexBudget: -1 }), RangeError);
  assert.throws(() => update({ vertexBudget: 1.5 }), RangeError);
  assert.throws(() => update({ vertexBudget: '1' }), TypeError);
  assert.throws(() => update({ faceBudget: -1 }), RangeError);
  assert.throws(() => update({ faceBudget: 3.5 }), RangeError);
  assert.throws(() => update({ faceBudget: '3' }), TypeError);
  assert.throws(() => update({ demands: [
    { ...valid, silhouette: 1 },
  ] }), TypeError);
  assert.throws(() => update({ demands: [
    { ...valid, projectedErrorPixels: NaN },
  ] }), RangeError);
  assert.throws(() => update({ demands: [
    { ...valid, errorBoundPixels: -1 },
  ] }), RangeError);
  assert.throws(() => update({}, {}), TypeError);

  const otherCoarse = createCoarseEllipsoidReference({ radii: [3, 2, 1.5] });
  const otherState = updateEllipsoidRefinementWorkingSetReference(otherCoarse, null, {
    demands: [valid],
    vertexBudget: 1,
    faceBudget: 3,
  });
  assert.throws(() => update({}, otherState), RangeError);
  assert.throws(() => update({}, null, {}), TypeError);
});

test('opposite camera demands converge to a bounded steady state', () => {
  const coarse = createCoarseEllipsoidReference({ radii: [3, 2, 1.5] });
  const camera = {
    eye: [8, 0, 0],
    target: [0, 0, 0],
    up: [0, 0, 1],
    verticalFovRadians: Math.PI / 3,
    viewportHeight: 1080,
  };
  const activeForEye = (eye) => {
    const selection = selectEllipsoidViewDemandReference(coarse, {
      camera: { ...camera, eye },
      maxErrorPixels: 0,
      budget: 4,
    });
    const active = new Set(selection.demands);
    return selection.candidates.filter(({ face }) => active.has(face));
  };
  const update = (previous, demands) => updateEllipsoidRefinementWorkingSetReference(
    coarse,
    previous,
    { demands, vertexBudget: 2, faceBudget: 6 },
  );
  const positiveDemands = activeForEye([8, 0, 0]);
  const negativeDemands = activeForEye([-8, 0, 0]);
  const positive = update(null, positiveDemands);
  const negative = update(positive, negativeDemands);
  const negativeSteady = update(negative, [...negativeDemands].reverse());
  const positiveRegenerated = update(negativeSteady, positiveDemands);

  assert.deepEqual(positive.entries.map(({ face }) => face), [
    'face:+x:+y:+z',
    'face:+x:+y:-z',
  ]);
  assert.deepEqual(negative.entries.map(({ face }) => face), [
    'face:-x:+y:+z',
    'face:-x:+y:-z',
  ]);
  assert.deepEqual(negative.changes, {
    retained: [],
    created: ['face:-x:+y:+z', 'face:-x:+y:-z'],
    evicted: ['face:+x:+y:+z', 'face:+x:+y:-z'],
  });
  assert.strictEqual(negativeSteady.entries[0], negative.entries[0]);
  assert.strictEqual(negativeSteady.entries[1], negative.entries[1]);
  assert.deepEqual(negativeSteady.changes, {
    retained: ['face:-x:+y:+z', 'face:-x:+y:-z'],
    created: [],
    evicted: [],
  });
  assert.deepEqual(positiveRegenerated.entries, positive.entries);
  assert.deepEqual(positiveRegenerated.usage, { vertices: 2, faces: 6 });
  assert.strictEqual(positiveRegenerated.coarse, coarse);
});

test('budget sweep bounds all detail and empty demand evicts it all', () => {
  const coarse = createCoarseEllipsoidReference({ radii: [3, 2, 1.5] });
  const demands = coarse.faces.map(({ id }, index) => demand(id, {
    silhouette: index % 2 === 0,
    silhouetteErrorPixels: index % 2 === 0 ? 100 - index : 0,
    projectedErrorPixels: 100 - index,
    errorBoundPixels: 120 - index,
  }));
  const update = (previous, active, vertexBudget, faceBudget) => (
    updateEllipsoidRefinementWorkingSetReference(coarse, previous, {
      demands: active,
      vertexBudget,
      faceBudget,
    })
  );

  for (let vertexBudget = 0; vertexBudget <= 8; vertexBudget += 1) {
    for (let faceBudget = 0; faceBudget <= 24; faceBudget += 1) {
      const state = update(null, demands, vertexBudget, faceBudget);
      assert.ok(state.usage.vertices <= vertexBudget);
      assert.ok(state.usage.faces <= faceBudget);
      assert.equal(state.usage.vertices, state.entries.length);
      assert.equal(state.usage.faces, state.entries.length * 3);
    }
  }

  const full = update(null, demands, 8, 24);
  const empty = update(full, [], 8, 24);
  assert.equal(full.entries.length, 8);
  assert.deepEqual(empty.entries, []);
  assert.deepEqual(empty.usage, { vertices: 0, faces: 0 });
  assert.deepEqual(empty.changes, {
    retained: [],
    created: [],
    evicted: full.entries.map(({ face }) => face),
  });
  assert.strictEqual(empty.coarse, coarse);
});
