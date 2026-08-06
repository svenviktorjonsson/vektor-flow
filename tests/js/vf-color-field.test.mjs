import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createCanvasColorFieldRenderer,
  evaluateColorFieldRgb,
  pointSourceRgb,
  segmentSourceRgb,
} from '../../web/vf-ui/vf-color-field.mjs';

const inverseSquare = ({ x, y }) => 1 / (x * x + y * y);

test('normalizes point-source weights in source-relative coordinates', () => {
  assert.deepEqual(pointSourceRgb(
    [1, 1],
    [[0, 0], [3, 1]],
    ['#ff0000', '#0000ff'],
    inverseSquare,
  ), [170, 0, 85]);
  assert.deepEqual(pointSourceRgb(
    [3, 1],
    [[0, 0], [3, 1]],
    ['#ff0000', '#0000ff'],
    inverseSquare,
  ), [0, 0, 255]);
});

test('normalizes segment-source weights from distance to complete segments', () => {
  assert.deepEqual(segmentSourceRgb(
    [0, 1],
    [[[0, 0], [10, 0]], [[0, 10], [10, 10]]],
    ['#ff0000', '#0000ff'],
    inverseSquare,
  ), [252, 0, 3]);
});

test('evaluates point and segment field descriptors through one interface', () => {
  assert.deepEqual(evaluateColorFieldRgb([1, 1], {
    kind: 'point-distance',
    points: [[0, 0], [3, 1]],
    colors: ['#ff0000', '#0000ff'],
    weightEvaluator: inverseSquare,
  }), [170, 0, 85]);
});

test('canvas adapter owns raster bounds, sampling, and buffer upload', () => {
  const canvas = { width: 0, height: 0 };
  const uploads = [];
  const context = {
    createImageData: (width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }),
    putImageData: (image, x, y) => uploads.push(['put', image, x, y]),
  };
  const draws = [];
  const renderer = createCanvasColorFieldRenderer({
    canvas,
    context,
    screenToWorld: (point) => point,
  });
  renderer.draw({
    targetContext: { drawImage: (...args) => draws.push(args) },
    screenPoints: [[1, 2], [3, 4]],
    targetSize: [10, 10],
    field: {
      kind: 'point-distance',
      points: [[0, 0], [10, 0]],
      colors: ['#ff0000', '#0000ff'],
      weightEvaluator: inverseSquare,
    },
  });
  assert.deepEqual([canvas.width, canvas.height], [2, 2]);
  assert.equal(uploads.length, 1);
  assert.deepEqual(draws[0].slice(1), [1, 2]);
});
