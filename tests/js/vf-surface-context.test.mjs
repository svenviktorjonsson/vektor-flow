import assert from 'node:assert/strict';
import test from 'node:test';

import { createSurfaceContextRegistry } from '../../web/vf-ui/vf-surface-context.mjs';

const triangle = Object.freeze([[0, 0], [4, 0], [0, 4]]);

function child(overrides = {}) {
  return {
    id: 'surface:f0',
    parentId: 'root',
    faceId: 'f0',
    frame: [2, 0, 0, 2, 10, -3],
    clipPolygon: triangle,
    ...overrides
  };
}

test('enters and exits a child while exposing one focused local grid', () => {
  const root = createSurfaceContextRegistry({ contexts: [child()] });
  assert.equal(root.activeId, 'root');
  assert.equal(root.renderDescriptor('root').gridVisible, true);
  assert.equal(root.renderDescriptor('surface:f0').gridVisible, false);

  const entered = root.enter('surface:f0');
  assert.deepEqual(entered.stack, ['root', 'surface:f0']);
  assert.equal(entered.renderDescriptor('surface:f0').gridVisible, true);
  assert.equal(entered.renderDescriptor('surface:f0').dimOutside, true);
  assert.equal(entered.exit().activeId, 'root');
});

test('maps nested local points through immutable affine contexts', () => {
  const registry = createSurfaceContextRegistry({ contexts: [
    child(),
    child({
      id: 'surface:f1',
      parentId: 'surface:f0',
      faceId: 'f1',
      frame: [0, 1, -1, 0, 3, 1]
    })
  ] });

  const world = registry.localToWorld('surface:f1', [2, 1]);
  assert.deepEqual(world, [14, 3]);
  assert.deepEqual(registry.worldToLocal('surface:f1', world), [2, 1]);
  assert.deepEqual(registry.localToParent('surface:f1', [2, 1]), [2, 3]);
  assert.equal(registry.activeId, 'root');
});

test('deforming a clip does not change the stable internal coordinate frame', () => {
  const registry = createSurfaceContextRegistry({ contexts: [child()] });
  const before = registry.worldAffine('surface:f0');
  const deformed = registry.updateClip('surface:f0', [[0, 0], [5, 0], [1, 3]]);

  assert.deepEqual(deformed.worldAffine('surface:f0'), before);
  assert.deepEqual(deformed.get('surface:f0').clipPolygon, [[0, 0], [5, 0], [1, 3]]);
  assert.deepEqual(registry.get('surface:f0').clipPolygon, triangle);
});

test('full similarity transforms move the frame and its world clip together', () => {
  const registry = createSurfaceContextRegistry({ contexts: [child()] });
  const moved = registry.translate('surface:f0', [3, 5]).rotate('surface:f0', Math.PI / 2);
  const descriptor = moved.renderDescriptor('surface:f0');

  assert.deepEqual(moved.localToWorld('surface:f0', [0, 0]).map(round), [-2, 13]);
  assert.deepEqual(descriptor.worldClipPolygon[0].map(round), [-2, 13]);
  assert.deepEqual(descriptor.worldClipPolygon[1].map(round), [-2, 21]);
});

test('all descendants retain the same inherited time handle', () => {
  const timeHandle = Object.freeze({ now: () => 12.5 });
  const registry = createSurfaceContextRegistry({ timeHandle, contexts: [child()] });
  assert.equal(registry.renderDescriptor('root').timeHandle, timeHandle);
  assert.equal(registry.renderDescriptor('surface:f0').timeHandle, timeHandle);
});

test('rejects invalid hierarchy, singular transforms, and malformed clips', () => {
  assert.throws(() => createSurfaceContextRegistry({ contexts: [
    child({ parentId: 'missing' })
  ] }), /unknown parent/);
  assert.throws(() => createSurfaceContextRegistry({ contexts: [
    child({ frame: [1, 0, 0, 0, 0, 0] })
  ] }), /invertible/);
  assert.throws(() => createSurfaceContextRegistry({ contexts: [
    child({ clipPolygon: [[0, 0], [4, 4], [0, 2], [3, 0]] })
  ] }), /self-intersect/);
});

function round(value) {
  return Math.round(value * 1e9) / 1e9;
}
