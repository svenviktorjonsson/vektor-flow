import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SYMBOLIC_PLOT_VERTEX_STRIDE,
  SYMBOLIC_PLOT_EDGE_WIDTH,
  SYMBOLIC_PLOT_POINT_RADIUS,
  SYMBOLIC_PLOT_POINT_VERTICES,
  SymbolicPlotMode,
  createSymbolicPlotRenderer,
  growSymbolicPlotCapacity,
  normalizeSymbolicPlotAppearance,
  normalizeSymbolicPlotPickRequest,
  packSymbolicPlotSegments,
  resolveSymbolicPlotArena,
  symbolicPlotSelectionHalo,
  symbolicPlotPointDraws,
  webGlPointFragmentSource,
  webGlPointVertexSource,
  webGlStrokeVertexSource,
  webGlStrokeFragmentSource,
  webGpuShaderSource,
  symbolicPlotClipStencilDraws,
  triangulateSymbolicPlotClip,
  triangulateSymbolicPlotClipRegion
} from '../../web/vf-ui/geom/vf-symbolic-plot-renderer.mjs';

test('uses one centered selection halo instead of self-intersecting offset strokes', () => {
  const appearance = normalizeSymbolicPlotAppearance({
    edgeWidth: 2,
    selectionGap: 4,
    selectionWidth: 2
  });

  assert.deepEqual(symbolicPlotSelectionHalo(appearance), { width: 14, offset: 0 });
});

test('keeps curve selection joins at constant radius so contours cannot fold', () => {
  const shaders = [webGpuShaderSource(), webGlStrokeVertexSource()];
  for (const shader of shaders) {
    assert.match(shader, /abs\(distance(?:_value)?\) \* 1\.00/);
    assert.doesNotMatch(shader, /abs\(distance(?:_value)?\) \* 1\.25/);
  }
});

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

function createBackendLog(pickResult = { kind: 'segment', index: 0 }) {
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
      async pick(request) { calls.push(['pick', request]); return pickResult; },
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
    ['initialize', 'setArena', 'updateTransform', 'updateClip', 'updateAppearance', 'resize', 'render', 'pick', 'destroy']
      .filter((name) => typeof renderer[name] !== 'function'),
    []
  );
  assert.equal(await renderer.initialize(), 'mock-gpu');
  assert.equal(canvas.width, 640);
  assert.equal(canvas.height, 400);
  renderer.updateTransform([2, 0, 0, -2, 10, 20]);
  renderer.updateClip([[0, 0], [2, 0], [2, 2], [0, 2]]);
  renderer.updateClip({
    outer: [[0, 0], [4, 0], [4, 4], [0, 4]],
    holes: [[[1, 1], [2, 1], [1, 2]]]
  });
  renderer.destroy();

  assert.ok(calls.some(([name]) => name === 'transform'));
  assert.ok(calls.some(([name, geometry]) => (
    name === 'clip'
    && geometry.vertices.length === 12
    && geometry.outerCount === 6
    && geometry.holeRanges.length === 0
  )));
  const regionGeometry = calls.filter(([name]) => name === 'clip').at(-1)[1];
  assert.equal(regionGeometry.outerCount, 6);
  assert.deepEqual(regionGeometry.holeRanges, [{ first: 6, count: 3 }]);
  assert.equal(calls.at(-1)[0], 'destroy');
  assert.throws(() => renderer.render(), /destroyed/);
});

test('normalizes CSS-coordinate GPU pick requests and delegates to the backend', async () => {
  const { backend, calls } = createBackendLog();
  const renderer = createSymbolicPlotRenderer(createCanvas(), { backendFactory: async () => backend });
  await renderer.initialize();
  renderer.setArena({
    data: new Float32Array(12),
    count: 2,
    ranges: [{ mode: SymbolicPlotMode.TIME_CURVE, part: 'edge', first: 0, count: 2 }]
  });

  assert.deepEqual(await renderer.pick([40, 50], 9), {
    kind: 'segment', index: 0, part: 'edge', rangeIndex: 0, primitiveIndex: 0
  });
  assert.deepEqual(calls.find(([name]) => name === 'pick')[1], {
    x: 40, y: 50, radius: 9, width: 320, height: 200
  });
  assert.equal(await renderer.pick([-1, 50], 9), null);
  assert.throws(() => normalizeSymbolicPlotPickRequest([1, 2], -1, 10, 10), /non-negative/);
});

test('packs line strips with adjacent vertices for continuous screen-space joins', () => {
  const data = new Float32Array([
    1, 2, 1, 0, 0, 1,
    3, 4, 0, 1, 0, 1,
    5, 6, 0, 0, 1, 1
  ]);
  const segments = packSymbolicPlotSegments({
    data,
    ranges: [{ topology: 'line-strip', first: 0, count: 3 }]
  });
  assert.equal(segments.length, 34);
  assert.deepEqual(Array.from(segments.slice(0, 17)), [
    1, 2,
    ...Array.from(data.slice(0, 12)),
    5, 6,
    1
  ]);
  assert.deepEqual(Array.from(segments.slice(17)), [
    1, 2,
    ...Array.from(data.slice(6, 18)),
    5, 6,
    1
  ]);
});

test('uses edge-consistent plot width and distinct hover and selection opacity', () => {
  assert.equal(SYMBOLIC_PLOT_EDGE_WIDTH, 2);
  const normal = normalizeSymbolicPlotAppearance({ state: 'normal' });
  assert.equal(normal.edgeWidth, 2);
  assert.equal(normal.selectionAlpha, 0);
  assert.equal(normalizeSymbolicPlotAppearance({ state: 'hovered' }).selectionAlpha, 0.5);
  assert.equal(normalizeSymbolicPlotAppearance({ state: 'selected' }).selectionAlpha, 0.75);
  const mixed = normalizeSymbolicPlotAppearance({
    partStates: { edge: 'selected', face: 'hovered' }
  });
  assert.equal(mixed.state, 'mixed');
  assert.deepEqual(mixed.partStates, { edge: 'selected', face: 'hovered' });
  assert.equal(mixed.edgeSelectionAlpha, 0.75);
  assert.equal(mixed.faceSelectionAlpha, 0.5);
});

test('preserves semantic parts and enriches face picks with range provenance', async () => {
  const { backend } = createBackendLog({ kind: 'triangle', index: 0 });
  const renderer = createSymbolicPlotRenderer(createCanvas(), { backendFactory: async () => backend });
  await renderer.initialize();
  const arena = renderer.setArena({
    data: new Float32Array(5 * 6),
    count: 5,
    ranges: [
      { mode: SymbolicPlotMode.TRIANGLES, part: 'face', first: 0, count: 3 },
      { mode: SymbolicPlotMode.LINKED_LINE_SEGMENTS, part: 'edge', first: 3, count: 2 }
    ]
  });

  assert.deepEqual(arena.ranges.map(({ part }) => part), ['face', 'edge']);
  assert.deepEqual(arena.primitives.edges[0], { part: 'edge', rangeIndex: 1, primitiveIndex: 0 });
  assert.deepEqual(arena.primitives.faces[0], { part: 'face', rangeIndex: 0, primitiveIndex: 0 });
  assert.deepEqual(await renderer.pick([20, 20]), {
    kind: 'triangle', index: 0, part: 'face', rangeIndex: 0, primitiveIndex: 0
  });
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
    { mode: SymbolicPlotMode.TRIANGLES, part: 'face', first: 3, count: 3 },
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
  assert.equal(arena.ranges[2].part, 'face');
  assert.equal(arena.ranges[4].strokeScale, 0.5);
  assert.throws(
    () => resolveSymbolicPlotArena({
      data,
      count: 18,
      ranges: [{ mode: SymbolicPlotMode.TRIANGLES, first: 0, count: 2 }]
    }),
    /complete triangles/
  );
});

test('expands symbolic points into smooth GPU circle instances', () => {
  const arena = resolveSymbolicPlotArena({
    data: new Float32Array(4 * 6),
    count: 4,
    ranges: [
      { mode: SymbolicPlotMode.POINTS, first: 1, count: 2 },
      { mode: SymbolicPlotMode.LINKED_LINE_SEGMENTS, first: 0, count: 2 }
    ]
  });

  assert.equal(SYMBOLIC_PLOT_POINT_RADIUS, 6);
  assert.equal(SYMBOLIC_PLOT_POINT_VERTICES, 6);
  assert.deepEqual(symbolicPlotPointDraws(arena), [{
    first: 1,
    count: 2,
    verticesPerInstance: 6
  }]);
  assert.match(webGlPointVertexSource(), /gl_VertexID/);
  assert.match(webGlPointFragmentSource(), /fwidth/);
  assert.match(webGlPointFragmentSource(), /smoothstep/);
});

test('renders plotted curve strokes with analytic edge antialiasing on every GPU backend', () => {
  assert.match(webGpuShaderSource(), /strokeFragment/);
  assert.match(webGpuShaderSource(), /fwidth\(input\.edgeDistance\)/);
  assert.match(webGlStrokeFragmentSource(), /fwidth\(v_edge_distance\)/);
  assert.match(webGlStrokeFragmentSource(), /smoothstep/);
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

test('triangulates clip regions into subtractive stencil draws for both GPU backends', () => {
  const geometry = triangulateSymbolicPlotClipRegion({
    outer: [[0, 0], [4, 0], [4, 4], [0, 4]],
    holes: [
      [[1, 1], [2, 1], [2, 2], [1, 2]],
      [[2.5, 2.5], [3.5, 2.5], [3, 3.5]]
    ]
  });

  assert.equal(geometry.outerCount, 6);
  assert.equal(geometry.vertices.length, 30);
  assert.deepEqual(geometry.holeRanges, [
    { first: 6, count: 6 },
    { first: 12, count: 3 }
  ]);
  assert.deepEqual(symbolicPlotClipStencilDraws(geometry), [
    { first: 0, count: 6, reference: 1 },
    { first: 6, count: 6, reference: 0 },
    { first: 12, count: 3, reference: 0 }
  ]);
  assert.throws(
    () => triangulateSymbolicPlotClipRegion({ outer: [[0, 0], [1, 0], [0, 1]], holes: 'bad' }),
    /holes must be an array/
  );
});

test('grows GPU arena capacity geometrically and keeps existing capacity', () => {
  assert.equal(growSymbolicPlotCapacity(0, 1), 256);
  assert.equal(growSymbolicPlotCapacity(256, 256), 256);
  assert.equal(growSymbolicPlotCapacity(256, 257), 512);
  assert.equal(growSymbolicPlotCapacity(1024, 513), 1024);
});
