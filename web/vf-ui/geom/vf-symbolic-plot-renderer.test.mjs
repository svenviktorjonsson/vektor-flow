import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SYMBOLIC_PLOT_VERTEX_STRIDE,
  SymbolicPlotMode,
  createSymbolicPlotRenderer,
  resolveSymbolicPlotArena,
  triangulateSymbolicPlotClip
} from './vf-symbolic-plot-renderer.mjs';

function createCanvas() {
  return {
    clientWidth: 300,
    clientHeight: 180,
    width: 0,
    height: 0,
    getContext() {
      return null;
    }
  };
}

function createObservedBackend() {
  const observations = {
    clips: [],
    renders: [],
    transforms: []
  };
  return {
    observations,
    backend: {
      kind: 'observed-gpu',
      resize() {},
      updateTransform(transform) {
        observations.transforms.push([...transform]);
      },
      updateClip(triangles) {
        observations.clips.push(new Float32Array(triangles));
      },
      render(arena, upload) {
        observations.renders.push({ arena, upload });
      },
      destroy() {}
    }
  };
}

test('uploads the packed Float32 arena once per data identity and revision', async () => {
  const memory = new WebAssembly.Memory({ initial: 1 });
  const packed = new Float32Array(memory.buffer, 128, 6 * 6);
  packed.set(Array.from({ length: packed.length }, (_, index) => index + 0.25));
  const { backend, observations } = createObservedBackend();
  const renderer = createSymbolicPlotRenderer(createCanvas(), {
    backendFactory: async () => backend
  });
  await renderer.initialize();

  const specification = {
    memory,
    pointer: packed.byteOffset,
    count: 6,
    stride: SYMBOLIC_PLOT_VERTEX_STRIDE,
    revision: 41,
    mode: SymbolicPlotMode.TRIANGLES
  };
  const firstArena = renderer.setArena(specification);
  renderer.render();
  const secondArena = renderer.setArena({ ...specification });
  renderer.render();
  renderer.setArena({ ...specification, revision: 42 });
  renderer.render();

  assert.equal(firstArena.data, secondArena.data);
  assert.equal(firstArena.data.buffer, memory.buffer);
  assert.equal(firstArena.data.byteOffset, packed.byteOffset);
  assert.deepEqual([...firstArena.data], [...packed]);
  assert.deepEqual(
    observations.renders.map(({ upload }) => upload),
    [true, false, true]
  );

  const replacement = new Float32Array(packed);
  renderer.setArena({
    data: replacement,
    count: 6,
    revision: 42,
    mode: SymbolicPlotMode.TRIANGLES
  });
  renderer.render();
  assert.equal(observations.renders.at(-1).upload, true);
});

test('maps every symbolic range mode to its GPU primitive topology', () => {
  const ranges = [
    { mode: SymbolicPlotMode.POINTS, first: 0, count: 1 },
    { mode: SymbolicPlotMode.LINKED_LINE_SEGMENTS, first: 1, count: 2 },
    { mode: SymbolicPlotMode.TRIANGLES, first: 3, count: 3 },
    { mode: SymbolicPlotMode.SCALAR_FIELD_TRIANGLES, first: 6, count: 3 },
    { mode: SymbolicPlotMode.VECTOR_FIELD_GLYPHS, first: 9, count: 2 },
    { mode: SymbolicPlotMode.TIME_CURVE, first: 11, count: 7 }
  ];
  const arena = resolveSymbolicPlotArena({
    data: new Float32Array(18 * 6),
    count: 18,
    ranges
  });

  assert.deepEqual(
    arena.ranges.map(({ mode, topology, first, count }) => ({
      mode,
      topology,
      first,
      count
    })),
    [
      { ...ranges[0], topology: 'point-list' },
      { ...ranges[1], topology: 'line-list' },
      { ...ranges[2], topology: 'triangle-list' },
      { ...ranges[3], topology: 'triangle-list' },
      { ...ranges[4], topology: 'line-list' },
      { ...ranges[5], topology: 'line-strip' }
    ]
  );
});

test('forwards the complete data-to-screen affine transform to the GPU backend', async () => {
  const { backend, observations } = createObservedBackend();
  const renderer = createSymbolicPlotRenderer(createCanvas(), {
    backendFactory: async () => backend
  });
  await renderer.initialize();

  const transform = [1.25, -0.5, 0.75, 2, 96, -32];
  renderer.updateTransform(transform);
  transform[0] = 999;

  assert.deepEqual(observations.transforms.at(-1), [1.25, -0.5, 0.75, 2, 96, -32]);
  assert.throws(
    () => renderer.updateTransform([1, 0, 0, Number.NaN, 0, 0]),
    /must be finite/
  );
});

test('triangulates a concave face clip and applies it before rendering', async () => {
  const face = [[0, 0], [5, 0], [5, 4], [2.5, 2], [0, 4]];
  const expectedClip = triangulateSymbolicPlotClip(face);
  const { backend, observations } = createObservedBackend();
  const renderer = createSymbolicPlotRenderer(createCanvas(), {
    backendFactory: async () => backend
  });
  await renderer.initialize();

  renderer.updateClip(face);
  renderer.setArena({
    data: new Float32Array(3 * 6),
    count: 3,
    revision: 1,
    mode: SymbolicPlotMode.TRIANGLES
  });
  renderer.render();

  assert.equal(expectedClip.length, (face.length - 2) * 3 * 2);
  assert.deepEqual([...observations.clips.at(-1)], [...expectedClip]);
  assert.equal(observations.renders.length, 1);
  assert.equal(observations.renders[0].arena.ranges[0].topology, 'triangle-list');

  renderer.updateClip(null);
  assert.equal(observations.clips.at(-1).length, 0);
});
