import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createCanvasColorFieldRenderer,
  evaluateColorFieldRgba,
  evaluateColorFieldRgb,
  pointSourceRgb,
  segmentSourceRgb,
} from '../../web/vf-ui/vf-color-field.mjs';

const inverseSquare = ({ x, y }) => 1 / (x * x + y * y);

test('samples coordinate color fields through the supplied local frame', () => {
  const seen = [];
  const rgba = evaluateColorFieldRgba([5, 7], {
    kind: 'coordinate-colormap',
    worldToLocal: ([x, y]) => [y - 6, x - 5],
    evaluator: ({ x, y }) => {
      seen.push([x, y]);
      return x;
    },
    sampler: (value) => [Math.round(value * 255), 0, 0, 255],
  });

  assert.deepEqual(seen, [[1, 0]]);
  assert.deepEqual(rgba, [255, 0, 0, 255]);
});

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
  const seen = [];
  assert.deepEqual(segmentSourceRgb(
    [0, 1],
    [[[0, 0], [10, 0]], [[0, 10], [10, 10]]],
    ['#ff0000', '#0000ff'],
    (variables) => {
      seen.push(variables);
      return 1 / variables.r ** 2;
    },
  ), [252, 0, 3]);
  assert.deepEqual(seen, [{ r: 1 }, { r: 9 }]);
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

test('canvas adapter reuses an unchanged field raster', () => {
  const canvas = { width: 0, height: 0 };
  const context = {
    createImageData: (width, height) => ({ data: new Uint8ClampedArray(width * height * 4) }),
    putImageData() {},
  };
  let evaluations = 0;
  const field = {
    kind: 'coordinate-colormap',
    worldToLocal: (point) => point,
    evaluator: ({ x }) => {
      evaluations += 1;
      return x;
    },
    sampler: () => [0, 0, 0, 255],
  };
  const renderer = createCanvasColorFieldRenderer({
    canvas,
    context,
    screenToWorld: (point) => point,
  });
  const request = {
    targetContext: { drawImage() {} },
    screenPoints: [[0, 0], [2, 2]],
    targetSize: [10, 10],
    field,
  };

  renderer.draw(request);
  renderer.draw(request);
  assert.equal(evaluations, 4);
});

test('canvas adapter never reduces raster quality during interaction', () => {
  const canvas = { width: 0, height: 0 };
  const draws = [];
  let evaluations = 0;
  const renderer = createCanvasColorFieldRenderer({
    canvas,
    context: {
      createImageData: (width, height) => ({ data: new Uint8ClampedArray(width * height * 4) }),
      putImageData() {},
    },
    screenToWorld: (point) => point,
  });

  renderer.draw({
    targetContext: { drawImage: (...args) => draws.push(args) },
    screenPoints: [[0, 0], [1000, 1000]],
    targetSize: [1000, 1000],
    maxRasterPixels: 10_000,
    field: {
      kind: 'coordinate-colormap',
      worldToLocal: (point) => point,
      evaluator: () => { evaluations += 1; return 0.5; },
      sampler: () => [0, 0, 0, 255],
    },
  });

  assert.deepEqual([canvas.width, canvas.height], [1000, 1000]);
  assert.equal(evaluations, 1_000_000);
  assert.deepEqual(draws[0].slice(1), [0, 0]);
});

test('canvas adapter reuses the exact full-resolution local raster during rigid drag', () => {
  const canvas = { width: 0, height: 0 };
  const draws = [];
  let evaluations = 0;
  const contentKey = {};
  const evaluator = ({ x }) => { evaluations += 1; return x; };
  const sampler = () => [0, 0, 0, 255];
  const renderer = createCanvasColorFieldRenderer({
    canvas,
    context: {
      createImageData: (width, height) => ({ data: new Uint8ClampedArray(width * height * 4) }),
      putImageData() {},
    },
    screenToWorld: (point) => point,
  });
  const targetContext = { drawImage: (...args) => draws.push(args) };

  renderer.draw({
    targetContext,
    screenPoints: [[0, 0], [100, 100]],
    targetSize: [200, 200],
    field: {
      kind: 'coordinate-colormap',
      cacheKey: 'face-1',
      contentKey,
      worldToLocal: (point) => point,
      evaluator,
      sampler,
    },
  });
  renderer.draw({
    targetContext,
    screenPoints: [[10, 20], [110, 120]],
    targetSize: [200, 200],
    field: {
      kind: 'coordinate-colormap',
      cacheKey: 'face-1',
      contentKey,
      worldToLocal: ([x, y]) => [x - 10, y - 20],
      evaluator,
      sampler,
    },
  });

  assert.equal(evaluations, 10_000);
  assert.deepEqual(draws.map((args) => args.slice(1)), [[0, 0], [10, 20]]);
  assert.deepEqual([canvas.width, canvas.height], [100, 100]);
});
