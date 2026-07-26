import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildScreenSpaceSimplexVertices,
  colorToRgba
} from '../../web/vf-ui/geom/vf-screen-simplex-renderer.mjs';

test('packs screen-space face, edge, and vertex primitives into one triangle buffer', () => {
  const vertices = buildScreenSpaceSimplexVertices({
    primitives: [
      {
        kind: 'face',
        points: [[10, 10], [30, 10], [20, 30]],
        color: '#336699'
      },
      {
        kind: 'edge',
        from: [10, 10],
        to: [30, 10],
        width: 4,
        color: '#ffffff'
      },
      {
        kind: 'vertex',
        center: [20, 20],
        radius: 5,
        segments: 8,
        color: 'rgba(255, 0, 0, 0.5)'
      }
    ]
  });

  const faceVertices = 3;
  const edgeVertices = 6;
  const pointVertices = 8 * 3;
  assert.equal(vertices.length, (faceVertices + edgeVertices + pointVertices) * 6);
  assert.deepEqual(Array.from(vertices.slice(0, 2)), [10, 10]);
  assert.ok(Math.abs(vertices[2] - 0.2) < 1e-6);
  assert.ok(Math.abs(vertices[3] - 0.4) < 1e-6);
  assert.ok(Math.abs(vertices[4] - 0.6) < 1e-6);
  assert.equal(vertices[5], 1);
});

test('keeps alpha and transparent colors deterministic', () => {
  assert.deepEqual(colorToRgba('rgba(12, 34, 56, 0.25)'), [
    12 / 255,
    34 / 255,
    56 / 255,
    0.25
  ]);
  assert.deepEqual(colorToRgba('transparent'), [0, 0, 0, 0]);
  assert.deepEqual(colorToRgba([0.1, 0.2, 0.3, 0.4]), [0.1, 0.2, 0.3, 0.4]);
});

test('skips malformed or degenerate primitives', () => {
  const vertices = buildScreenSpaceSimplexVertices({
    primitives: [
      { kind: 'face', points: [[0, 0], [1, 1]] },
      { kind: 'edge', from: [1, 1], to: [1, 1], width: 2 },
      { kind: 'vertex', center: null, radius: 2 },
      { kind: 'unknown' }
    ]
  });

  assert.equal(vertices.length, 0);
});
