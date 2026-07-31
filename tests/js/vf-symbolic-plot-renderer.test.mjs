import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SYMBOLIC_PLOT_VERTEX_STRIDE,
  SYMBOLIC_PLOT_EDGE_WIDTH,
  SymbolicPlotMode,
  createSymbolicPlotRenderer,
  growSymbolicPlotCapacity,
  normalizeSymbolicPlotAppearance,
  packSymbolicPlotSegments,
  resolveSymbolicPlotArena,
  triangulateSymbolicPlotClip
} from '../../web/vf-ui/geom/vf-symbolic-plot-renderer.mjs';

function createCanvas() {
  return {
    clientWidth: 320,
    clientHeight: 200,
    width: 0,
    height: 0,
    getContext() {
      return null;
    }
  };
}

function createBackendLog() {
  const calls = [];
  return {
    calls,
    backend: {
      kind: 'mock-gpu',
      resize(...args) { calls.push(['resize', ...args]); },
      updateTransform(value) { calls.push(['transform', value]); },
      updateClip(value) { calls.push(['clip', value]); },
      updateAppearance(value) { calls.push(['appearance', value]); },
      render(arena, upload) { calls.push(['render', arena, upload]); },
      destroy() { calls.push(['destroy']); }
    }
  };
}

test('exposes the stable arena renderer contract', async () => {
  const { backend, calls } = createBackendLog();
  const canvas = createCanvas();
  const renderer = createSymbolicPlotRenderer(canvas, {
    pixelRatio: () => 2,
    backendFactory: async () => backend
  });

  assert.deepEqual(
    ['initialize', 'setArena', 'updateTransform', 'updateClip', 'updateAppearance', 'resize', 'render', 'destroy']
      .filter((name) => typeof renderer[name] !== 'function'),
    []
  );
  assert.equal(await renderer.initialize(), 'mock-gpu');
  assert.equal(canvas.width, 640);
  assert.equal(canvas.height, 400);
  renderer.updateTransform([2, 0, 0, -2, 10, 20]);
  renderer.updateClip([[0, 0], [2, 0], [2, 2], [0, 2]]);
  renderer.destroy();

  assert.ok(calls.some(([name]) => name === 'transform'));
  assert.ok(calls.some(([name, triangles]) => name === 'clip' && triangles.length === 12));
  assert.equal(calls.at(-1)[0], 'destroy');
  assert.throws(() => renderer.render(), /destroyed/);
});

test('packs line lists and strips once for instanced screen-space strokes', () => {
  const data = new Float32Array([
    1, 2, 1, 0, 0, 1,
    3, 4, 0, 1, 0, 1,
    5, 6, 0, 0, 1, 1
  ]);
  const segments = packSymbolicPlotSegments({
    data,
    ranges: [{ topology: 'line-strip', first: 0, count: 3 }]
  });
  assert.equal(segments.length, 24);
  assert.deepEqual(Array.from(segments.slice(0, 12)), Array.from(data.slice(0, 12)));
  assert.deepEqual(Array.from(segments.slice(12)), Array.from(data.slice(6, 18)));
});

test('uses edge-consistent plot width and distinct hover and selection opacity', () => {
  assert.equal(SYMBOLIC_PLOT_EDGE_WIDTH, 2);
  const normal = normalizeSymbolicPlotAppearance({ state: 'normal' });
  assert.equal(normal.edgeWidth, 2);
  assert.equal(normal.selectionAlpha, 0);
  assert.equal(normalizeSymbolicPlotAppearance({ state: 'hovered' }).selectionAlpha, 0.5);
  assert.equal(normalizeSymbolicPlotAppearance({ state: 'selected' }).selectionAlpha, 0.75);
});

test('reuses a WASM arena view and deduplicates uploads by revision', async () => {
  const memory = new WebAssembly.Memory({ initial: 1 });
  const { backend, calls } = createBackendLog();
  const renderer = createSymbolicPlotRenderer(createCanvas(), {
    backendFactory: async () => backend
  });
  await renderer.initialize();

  const spec = {
    memory,
    pointer: 64,
    count: 6,
    stride: SYMBOLIC_PLOT_VERTEX_STRIDE,
    revision: 7,
    ranges: [{
      mode: SymbolicPlotMode.LINKED_LINE_SEGMENTS,
      first: 0,
      count: 6
    }]
  };
  const first = renderer.setArena(spec);
  renderer.render();
  const second = renderer.setArena({ ...spec });
  renderer.render();

  const renders = calls.filter(([name]) => name === 'render');
  assert.equal(first.data, second.data);
  assert.equal(renders[0][2], true);
  assert.equal(renders[1][2], false);

  renderer.setArena({ ...spec, revision: 8 });
  renderer.render();
  assert.equal(calls.filter(([name]) => name === 'render').at(-1)[2], true);

  const otherData = new Float32Array(6 * 6);
  renderer.setArena({
    data: otherData,
    count: 6,
    revision: 8,
    ranges: spec.ranges
  });
  renderer.render();
  assert.equal(calls.filter(([name]) => name === 'render').at(-1)[2], true);
});

test('refreshes the WASM arena view after memory growth', () => {
  const memory = new WebAssembly.Memory({ initial: 1 });
  const spec = {
    memory,
    pointer: 0,
    count: 3,
    revision: 1,
    mode: SymbolicPlotMode.TRIANGLES
  };
  const before = resolveSymbolicPlotArena(spec);
  memory.grow(1);
  const after = resolveSymbolicPlotArena({ ...spec, revision: 2 }, before);

  assert.notEqual(before.sourceBuffer, after.sourceBuffer);
  assert.notEqual(before.data, after.data);
  assert.equal(after.data.buffer, memory.buffer);
});

test('validates all plot primitive modes without repacking vertex data', () => {
  const data = new Float32Array(18 * 6);
  const ranges = [
    { mode: SymbolicPlotMode.POINTS, first: 0, count: 1 },
    { mode: SymbolicPlotMode.LINKED_LINE_SEGMENTS, first: 1, count: 2 },
    { mode: SymbolicPlotMode.TRIANGLES, first: 3, count: 3 },
    { mode: SymbolicPlotMode.SCALAR_FIELD_TRIANGLES, first: 6, count: 3 },
    { mode: SymbolicPlotMode.VECTOR_FIELD_GLYPHS, first: 9, count: 2 },
    { mode: SymbolicPlotMode.TIME_CURVE, first: 11, count: 7 }
  ];
  const arena = resolveSymbolicPlotArena({ data, count: 18, revision: 1, ranges });

  assert.equal(arena.data, data);
  assert.deepEqual(
    arena.ranges.map(({ topology }) => topology),
    ['point-list', 'line-list', 'triangle-list', 'triangle-list', 'line-list', 'line-strip']
  );
  assert.throws(
    () => resolveSymbolicPlotArena({
      data,
      count: 18,
      ranges: [{ mode: SymbolicPlotMode.TRIANGLES, first: 0, count: 2 }]
    }),
    /complete triangles/
  );
});

test('triangulates a concave clip polygon with exact polygon area', () => {
  const polygon = [[0, 0], [4, 0], [4, 4], [2, 2], [0, 4]];
  const triangles = triangulateSymbolicPlotClip(polygon);
  assert.equal(triangles.length, (polygon.length - 2) * 3 * 2);

  let triangleArea = 0;
  for (let index = 0; index < triangles.length; index += 6) {
    triangleArea += Math.abs(
      (triangles[index + 2] - triangles[index])
      * (triangles[index + 5] - triangles[index + 1])
      - (triangles[index + 4] - triangles[index])
      * (triangles[index + 3] - triangles[index + 1])
    ) / 2;
  }
  assert.equal(triangleArea, 12);
});

test('grows GPU arena capacity geometrically and keeps existing capacity', () => {
  assert.equal(growSymbolicPlotCapacity(0, 1), 256);
  assert.equal(growSymbolicPlotCapacity(256, 256), 256);
  assert.equal(growSymbolicPlotCapacity(256, 257), 512);
  assert.equal(growSymbolicPlotCapacity(1024, 513), 1024);
});
