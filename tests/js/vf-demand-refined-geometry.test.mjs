import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createCoarseEllipsoidReference,
} from '../../web/vf-ui/vf-demand-refined-geometry.mjs';

test('coarse ellipsoid has pinned stable vertices and face identities', () => {
  const shape = createCoarseEllipsoidReference({ radii: [3, 2, 1.5] });

  assert.deepEqual(
    shape.vertices.map(({ id, position }) => ({ id, position })),
    [
      { id: 'vertex:+x', position: [3, 0, 0] },
      { id: 'vertex:-x', position: [-3, 0, 0] },
      { id: 'vertex:+y', position: [0, 2, 0] },
      { id: 'vertex:-y', position: [0, -2, 0] },
      { id: 'vertex:+z', position: [0, 0, 1.5] },
      { id: 'vertex:-z', position: [0, 0, -1.5] },
    ],
  );
  assert.deepEqual(shape.faces.map(({ id }) => id), [
    'face:+x:+y:+z',
    'face:-x:+y:+z',
    'face:-x:-y:+z',
    'face:+x:-y:+z',
    'face:+x:+y:-z',
    'face:-x:+y:-z',
    'face:-x:-y:-z',
    'face:+x:-y:-z',
  ]);
  assert.ok(Object.isFrozen(shape));
  assert.ok(Object.isFrozen(shape.vertices));
  assert.ok(Object.isFrozen(shape.faces));
});
