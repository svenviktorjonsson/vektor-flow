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

test('camera projection pins conservative edge-error bounds and thresholds', () => {
  const shape = createCoarseEllipsoidReference({ radii: [3, 2, 1.5] });
  const select = (eyeX, maxErrorPixels = 0) => selectEllipsoidViewDemandReference(shape, {
    camera: { ...camera, eye: [eyeX, 0, 0] },
    maxErrorPixels,
    budget: 4,
  });
  const near = select(8);
  const far = select(16);

  assert.deepEqual(near.candidates[0], {
    face: 'face:+x:+y:+z',
    silhouette: true,
    silhouetteEdges: ['edge:vertex:+y|vertex:+z'],
    silhouetteErrorPixels: 60.533910158706625,
    projectedErrorPixels: 108.09023430565387,
    errorBoundPixels: 230.11397265001793,
  });
  assert.deepEqual(far.candidates[0], {
    face: 'face:+x:+y:+z',
    silhouette: true,
    silhouetteEdges: ['edge:vertex:+y|vertex:+z'],
    silhouetteErrorPixels: 30.266955079353313,
    projectedErrorPixels: 36.849502683549346,
    errorBoundPixels: 72.94398963969292,
  });
  assert.ok(near.candidates.every(
    ({ projectedErrorPixels, errorBoundPixels }) => projectedErrorPixels < errorBoundPixels,
  ));
  assert.ok(far.candidates.every(
    ({ projectedErrorPixels, errorBoundPixels }) => projectedErrorPixels < errorBoundPixels,
  ));
  assert.equal(select(8, 230).demands.length, 4);
  assert.equal(select(8, 231).demands.length, 0);
  assert.equal(select(16, 72).demands.length, 4);
  assert.equal(select(16, 73).demands.length, 0);
});

test('silhouette candidates outrank a visible interior face', () => {
  const shape = createCoarseEllipsoidReference({ radii: [3, 2, 1.5] });
  const select = (budget) => selectEllipsoidViewDemandReference(shape, {
    camera: { ...camera, eye: [8, 8, 8] },
    maxErrorPixels: 0,
    budget,
  });
  const selection = select(3);

  assert.deepEqual(selection.demands, [
    'face:-x:+y:+z',
    'face:+x:-y:+z',
    'face:+x:+y:-z',
  ]);
  assert.ok(selection.candidates.slice(0, 3).every(({ silhouette }) => silhouette));
  assert.deepEqual(selection.candidates[3], {
    face: 'face:+x:+y:+z',
    silhouette: false,
    silhouetteEdges: [],
    silhouetteErrorPixels: 0,
    projectedErrorPixels: 38.242090004204954,
    errorBoundPixels: 86.40356475624637,
  });
  assert.deepEqual(selection.culled, [
    'face:-x:-y:+z',
    'face:-x:+y:-z',
    'face:-x:-y:-z',
    'face:+x:-y:-z',
  ]);
  assert.deepEqual(select(4).demands, [
    ...selection.demands,
    'face:+x:+y:+z',
  ]);
});

test('face demands are stable across traversal order and chunks', () => {
  const shape = createCoarseEllipsoidReference({ radii: [3, 2, 1.5] });
  const ids = shape.faces.map(({ id }) => id);
  const select = (traversalChunks) => selectEllipsoidViewDemandReference(shape, {
    camera: { ...camera, eye: [8, 8, 8] },
    maxErrorPixels: 0,
    budget: 3,
    traversalChunks,
  });
  const forward = select([ids]);
  const reversed = select([[...ids].reverse()]);
  const chunked = select([ids.slice(0, 1), ids.slice(1, 6), ids.slice(6)]);

  assert.deepEqual(reversed, forward);
  assert.deepEqual(chunked, forward);
  assert.throws(() => select([ids.slice(1)]), RangeError);
  assert.throws(() => select([[ids[0], ...ids]]), RangeError);
  assert.throws(() => select([[...ids.slice(0, -1), 'face:missing']]), RangeError);
});
