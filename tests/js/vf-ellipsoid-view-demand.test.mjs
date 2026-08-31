import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createCoarseEllipsoidReference,
} from '../../web/vf-ui/vf-demand-refined-geometry.mjs';
import {
  selectEllipsoidViewDemandReference,
} from '../../web/vf-ui/vf-ellipsoid-view-demand.mjs';

const camera = Object.freeze({
  eye: Object.freeze([8, 0, 0]),
  target: Object.freeze([0, 0, 0]),
  up: Object.freeze([0, 0, 1]),
  verticalFovRadians: Math.PI / 3,
  viewportHeight: 1080,
});

test('view demand spends a small budget on visible silhouette faces first', () => {
  const shape = createCoarseEllipsoidReference({ radii: [3, 2, 1.5] });
  const selection = selectEllipsoidViewDemandReference(shape, {
    camera,
    maxErrorPixels: 0,
    budget: 2,
  });

  assert.deepEqual(selection.demands, [
    'face:+x:+y:+z',
    'face:+x:+y:-z',
  ]);
  assert.equal(selection.candidates.length, 4);
  assert.ok(selection.candidates.every(({ silhouette }) => silhouette));
  assert.deepEqual(selection.culled, [
    'face:-x:+y:+z',
    'face:-x:-y:+z',
    'face:-x:+y:-z',
    'face:-x:-y:-z',
  ]);
  assert.ok(Object.isFrozen(selection));
  assert.ok(Object.isFrozen(selection.demands));
  assert.ok(Object.isFrozen(selection.candidates));
});

test('view demand enforces its explicit small refinement budget', () => {
  const shape = createCoarseEllipsoidReference({ radii: [3, 2, 1.5] });
  const select = (budget) => selectEllipsoidViewDemandReference(shape, {
    camera,
    maxErrorPixels: 0,
    budget,
  });

  assert.throws(() => select(-1), RangeError);
  assert.throws(() => select(1.5), RangeError);
  assert.throws(() => select(65), RangeError);
  assert.throws(() => select('2'), TypeError);
  for (let budget = 0; budget <= 4; budget += 1) {
    assert.ok(select(budget).demands.length <= budget);
  }
});
