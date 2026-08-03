import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildScreenSpaceSimplexVertices,
  colorToRgba,
  growPackedVertexCapacity,
  requirePackedSimplexVertices
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

test('interpolates face corners and edge endpoints on the GPU', () => {
  const vertices = buildScreenSpaceSimplexVertices({
    primitives: [
      {
        kind: 'face',
        points: [[0, 0], [10, 0], [0, 10]],
        colors: ['#ff0000', '#00ff00', '#0000ff']
      },
      {
        kind: 'edge',
        from: [0, 20],
        to: [10, 20],
        width: 2,
        fromColor: '#ff0000',
        toColor: '#0000ff'
      }
    ]
  });

  assert.deepEqual(Array.from(vertices.slice(2, 6)), [1, 0, 0, 1]);
  assert.deepEqual(Array.from(vertices.slice(8, 12)), [0, 1, 0, 1]);
  assert.deepEqual(Array.from(vertices.slice(14, 18)), [0, 0, 1, 1]);
  const edgeOffset = 3 * 6;
  assert.deepEqual(Array.from(vertices.slice(edgeOffset + 2, edgeOffset + 6)), [1, 0, 0, 1]);
  assert.deepEqual(Array.from(vertices.slice(edgeOffset + 14, edgeOffset + 18)), [0, 0, 1, 1]);
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

test('accepts a WASM-backed packed triangle view without copying it', () => {
  const memory = new WebAssembly.Memory({ initial: 1 });
  const packed = new Float32Array(memory.buffer, 64, 18);

  assert.equal(requirePackedSimplexVertices(packed), packed);
  assert.throws(
    () => requirePackedSimplexVertices(new Float32Array(17)),
    /complete triangles/,
  );
  assert.throws(
    () => requirePackedSimplexVertices(new Float64Array(18)),
    /Float32Array/,
  );
});

test('grows GPU vertex capacity geometrically and reuses it', () => {
  assert.equal(growPackedVertexCapacity(0, 1), 256);
  assert.equal(growPackedVertexCapacity(256, 18 * 4), 256);
  assert.equal(growPackedVertexCapacity(256, 257), 512);
  assert.equal(growPackedVertexCapacity(512, 257), 512);
});
