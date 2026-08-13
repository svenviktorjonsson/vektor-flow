import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { createSymbolicKernel } from '../../web/vf-ui/vf-symbolic-kernel-runtime.mjs';
import { createSymbolicPlotController } from '../../web/vf-ui/vf-symbolic-plot-controller.mjs';

const artifactRoot = new URL('../../web/vf-ui/artifacts/', import.meta.url);

test('emits an ordered smooth sin(x) line strip across negative pi', async () => {
  const wasm = await readFile(new URL('vkf-symbolic-kernel.wasm', artifactRoot));
  const manifest = JSON.parse(
    await readFile(new URL('vkf-symbolic-kernel.json', artifactRoot), 'utf8')
  );
  const { instance } = await WebAssembly.instantiate(wasm);
  const kernel = createSymbolicKernel({ instance, manifest });
  const program = kernel.compile('sin(x)');
  const workspace = kernel.createWorkspace();
  const xMin = -3.3;
  const xMax = -3.0;
  const xSteps = 65;
  const plot = kernel.plot(
    program.handle,
    workspace.handle,
    {
      xMin,
      xMax,
      yMin: -1,
      yMax: 1,
      xSteps,
      ySteps: 9,
      fieldXSteps: 9,
      fieldYSteps: 9,
      tMin: 0,
      tMax: 1,
      tSteps: 9,
      t: 0,
      vectorScale: 0.1
    },
    {
      edgeR: 1,
      edgeG: 1,
      edgeB: 1,
      edgeA: 1,
      faceR: 1,
      faceG: 1,
      faceB: 1,
      faceA: 1,
      valueMin: -1,
      valueMax: 1
    },
    1
  );
  const packed = plot.data;
  const points = Array.from({ length: plot.count }, (_, index) => ({
    x: packed[index * 6],
    y: packed[index * 6 + 1]
  }));

  assert.equal(plot.count, xSteps);
  assert.deepEqual(
    plot.ranges.map((range) => ({ ...range })),
    [{ mode: 'time-curve', part: 'edge', first: 0, count: xSteps }]
  );
  assert.ok(points.every((point, index) => index === 0 || points[index - 1].x < point.x));
  assert.ok(points.every((point) => Math.abs(point.y - Math.sin(point.x)) < 1e-6));
  assert.ok(points.every((point, index) => index === 0 || points[index - 1].y > point.y));

  const largestSecondDifference = Math.max(
    ...points.slice(1, -1).map((point, index) => (
      Math.abs(points[index].y - 2 * point.y + points[index + 2].y)
    ))
  );
  assert.ok(largestSecondDifference < 1e-4, `unexpected local spike: ${largestSecondDifference}`);
});

test('resolves the removable singularity in sin(x)/x during core plot evaluation', async () => {
  const wasm = await readFile(new URL('vkf-symbolic-kernel.wasm', artifactRoot));
  const manifest = JSON.parse(
    await readFile(new URL('vkf-symbolic-kernel.json', artifactRoot), 'utf8')
  );
  const { instance } = await WebAssembly.instantiate(wasm);
  const kernel = createSymbolicKernel({ instance, manifest });
  const workspace = kernel.createWorkspace();
  const view = {
    xMin: -1, xMax: 1, yMin: -1, yMax: 2, xSteps: 65, ySteps: 9,
    fieldXSteps: 9, fieldYSteps: 9,
    tMin: 0, tMax: 1, tSteps: 9, t: 0, vectorScale: 0.1
  };
  const style = {
    edgeR: 1, edgeG: 1, edgeB: 1, edgeA: 1,
    faceR: 1, faceG: 1, faceB: 1, faceA: 1,
    valueMin: -1, valueMax: 2
  };

  const sinc = kernel.compile('sin(x)/x');
  assert.ok(Math.abs(kernel.evaluate(sinc.handle, 0, 0) - 1) < 1e-6);
  const sincPlot = kernel.plot(sinc.handle, workspace.handle, view, style, 1);
  const centerY = sincPlot.data[Math.floor(view.xSteps / 2) * 6 + 1];
  assert.ok(Number.isFinite(centerY));
  assert.ok(Math.abs(centerY - 1) < 1e-6, `expected sinc(0)=1, received ${centerY}`);

  const pole = kernel.compile('1/(x^2)');
  const polePlot = kernel.plot(pole.handle, workspace.handle, view, style, 2);
  const poleCenterY = polePlot.data[Math.floor(view.xSteps / 2) * 6 + 1];
  assert.equal(Number.isFinite(poleCenterY), false);
});

test('evaluates temporal curves continuously beyond the sampled time window', async () => {
  const wasm = await readFile(new URL('vkf-symbolic-kernel.wasm', artifactRoot));
  const manifest = JSON.parse(
    await readFile(new URL('vkf-symbolic-kernel.json', artifactRoot), 'utf8')
  );
  const { instance } = await WebAssembly.instantiate(wasm);
  const kernel = createSymbolicKernel({ instance, manifest });
  const program = kernel.compile('sin(x-t)');
  const workspace = kernel.createWorkspace();
  const t = 10_000;
  const xMin = -2;
  const xMax = 2;
  const xSteps = 129;
  const plot = kernel.plot(
    program.handle,
    workspace.handle,
    {
      xMin, xMax, yMin: -1, yMax: 1, xSteps, ySteps: 9,
      fieldXSteps: 9, fieldYSteps: 9,
      tMin: 0, tMax: 1, tSteps: 9, t, vectorScale: 0.1
    },
    {
      edgeR: 1, edgeG: 1, edgeB: 1, edgeA: 1,
      faceR: 1, faceG: 1, faceB: 1, faceA: 1,
      valueMin: -1, valueMax: 1
    },
    1
  );
  const packed = plot.data;
  const points = Array.from({ length: plot.count }, (_, index) => ({
    x: packed[index * 6],
    y: packed[index * 6 + 1]
  }));

  assert.equal(plot.count, xSteps);
  assert.ok(points.every((point) => Math.abs(point.y - Math.sin(point.x - t)) < 1e-3));
  assert.ok(points.some((point) => Math.abs(point.y - Math.sin(point.x)) > 0.1));
});

test('controller updates joined sin(x-t) line strips beyond t=1', async () => {
  const wasm = await readFile(new URL('vkf-symbolic-kernel.wasm', artifactRoot));
  const manifest = JSON.parse(
    await readFile(new URL('vkf-symbolic-kernel.json', artifactRoot), 'utf8')
  );
  const { instance } = await WebAssembly.instantiate(wasm);
  const kernel = createSymbolicKernel({ instance, manifest });
  const arenas = [];
  const controller = await createSymbolicPlotController({
    canvas: { hidden: true },
    kernel,
    createRenderer: () => ({
      async initialize() {}, updateTransform() {}, updateClip() {}, updateAppearance() {},
      setAnalyticRelations() { return null; },
      setArena(arena) { arenas.push(arena); },
      render() {}, async pick() { return null; }, resize() {}, destroy() {}
    })
  });
  const viewport = {
    xMin: -2, xMax: 2, yMin: -1, yMax: 1,
    transform: [100, 0, 0, -100, 200, 100], pixelRatio: 1
  };

  for (const [frameRevision, t] of [0, 0.5, 1, 1.5, 2].entries()) {
    await controller.plot({
      source: 'sin(x-t)', viewport: { ...viewport, t },
      colors: { edge: '#ffffff', face: '#ffffff80' },
      revision: 4, frameRevision, frameEpoch: 1
    });
  }

  const curveArenas = arenas.filter((arena) => arena.ranges.length > 0);
  assert.equal(curveArenas.length, 5);
  assert.ok(curveArenas.every((arena) => arena.ranges[0]?.mode === 'time-curve'));
  assert.notDeepEqual(Array.from(curveArenas[0].data), Array.from(curveArenas.at(-1).data));
});

test('keeps transient plot memory bounded across 300 temporal frames', async () => {
  const wasm = await readFile(new URL('vkf-symbolic-kernel.wasm', artifactRoot));
  const manifest = JSON.parse(
    await readFile(new URL('vkf-symbolic-kernel.json', artifactRoot), 'utf8')
  );
  const { instance } = await WebAssembly.instantiate(wasm);
  const kernel = createSymbolicKernel({ instance, manifest });
  const arenas = [];
  const controller = await createSymbolicPlotController({
    canvas: { hidden: true },
    kernel,
    createRenderer: () => ({
      async initialize() {}, updateTransform() {}, updateClip() {}, updateAppearance() {},
      setAnalyticRelations() { return null; },
      setArena(arena) { arenas.push(arena); },
      render() {}, async pick() {
        return { kind: 'segment', index: 0, part: 'edge', rangeIndex: 0, primitiveIndex: 0 };
      },
      resize() {}, destroy() {}
    })
  });
  const viewport = {
    xMin: -2, xMax: 2, yMin: -1, yMax: 1,
    transform: [100, 0, 0, -100, 200, 100], pixelRatio: 1
  };
  const context = {
    kind: 'global', dimension: 2, originX: 0, originY: 0,
    basisXX: 1, basisXY: 0, basisYX: 0, basisYY: 1
  };
  const compilation = kernel.workspaceCompile(
    kernel.createWorkspace().handle,
    'sin(x-t)',
    context,
    null
  );

  await controller.plot({
    source: 'sin(x-t)', viewport: { ...viewport, t: 0 },
    colors: { edge: '#ffffff', face: '#ffffff80' },
    revision: 9, frameRevision: 0, frameEpoch: 1, compilation
  });
  const persistentHeapEnd = instance.exports.vkf_vm_heap_ptr();
  for (let frame = 1; frame < 300; frame += 1) {
    await controller.plot({
      source: 'sin(x-t)', viewport: { ...viewport, t: frame / 60 },
      colors: { edge: '#ffffff', face: '#ffffff80' },
      revision: 9, frameRevision: frame, frameEpoch: 1, compilation
    });
  }

  const curveArenas = arenas.filter((arena) => arena.ranges.length > 0);
  assert.equal(curveArenas.length, 300);
  assert.equal(instance.exports.vkf_vm_heap_ptr(), persistentHeapEnd);
  assert.ok(curveArenas.every((arena) => arena.ranges[0]?.mode === 'time-curve'));
  assert.ok(controller.snapGeometry.segments.length > 0);
});
