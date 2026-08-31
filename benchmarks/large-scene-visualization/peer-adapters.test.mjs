import assert from 'node:assert/strict';
import test from 'node:test';

import { generatePointFixtureBytes } from './point-fixture.mjs';
import {
  DECK_GL_VERSION,
  deckBinaryPositions,
} from './adapters/deck-gl.mjs';
import {
  PLOTLY_SCATTERGL_VERSION,
  plotlyPlanarPositions,
} from './adapters/plotly-scattergl.mjs';
import {
  VTK_JS_VERSION,
  vtkXyzPositions,
} from './adapters/vtk-js.mjs';
import { cameraRangesForFrame } from './adapters/browser-common.mjs';

const pan = {
  pointCount: 3,
  fixture: { generator: 'vkf-point-mix-v1', seed: 144862629 },
  cameraPath: {
    kind: 'sinusoidal-pan',
    frames: 240,
    xRange: [-1, 1],
    yRange: [-1, 1],
    xAmplitude: 0.2,
    yAmplitude: 0.1,
  },
};

test('peer adapters pin the exact frozen package versions', () => {
  assert.equal(DECK_GL_VERSION, '9.3.11');
  assert.equal(VTK_JS_VERSION, '36.10.0');
  assert.equal(PLOTLY_SCATTERGL_VERSION, '4.0.0');
});

test('all peers receive the exact camera domains at every checkpoint', () => {
  assert.deepEqual(cameraRangesForFrame(pan, 0), {
    x: [-1, 1],
    y: [-0.9, 1.1],
    offset: [0, 0.1],
  });
  const frame60 = cameraRangesForFrame(pan, 60);
  assert.ok(Math.abs(frame60.x[0] + 0.8) < 1e-12);
  assert.ok(Math.abs(frame60.x[1] - 1.2) < 1e-12);
  assert.ok(Math.abs(frame60.y[0] + 1) < 1e-12);
  assert.ok(Math.abs(frame60.y[1] - 1) < 1e-12);
});

test('deck retains interleaved bytes while VTK and Plotly make one preparation-only conversion', () => {
  const bytes = generatePointFixtureBytes(pan.fixture, pan.pointCount);
  const points = new Float32Array(bytes.buffer);
  const deck = deckBinaryPositions(points, pan.pointCount);
  const vtk = vtkXyzPositions(points, pan.pointCount);
  const plotly = plotlyPlanarPositions(points, pan.pointCount);

  assert.equal(deck.value, points);
  assert.equal(deck.size, 2);
  assert.deepEqual([...vtk], [points[0], points[1], 0, points[2], points[3], 0, points[4], points[5], 0]);
  assert.deepEqual([...plotly.x], [points[0], points[2], points[4]]);
  assert.deepEqual([...plotly.y], [points[1], points[3], points[5]]);
});
