import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildSymbolicPlotView,
  createSymbolicPlotController,
  hitTestSymbolicPlotGeometry,
  symbolicClipInLocalCoordinates,
  symbolicCssPixelTransform,
  symbolicDataToScreenTransform,
  symbolicPlotSnapGeometry
} from 'vektor-flow/symbolic-plot-controller';

const viewport = Object.freeze({
  xMin: -8,
  xMax: 8,
  yMin: -5,
  yMax: 5,
  transform: [32, 1, -2, -32, 300, 240]
});

test('normalizes device transforms at DPR 2 and 3', () => {
  assert.deepEqual(symbolicCssPixelTransform([80, 4, -6, -80, 600, 1000], 2),
    [40, 2, -3, -40, 300, 500]);
  assert.deepEqual(symbolicCssPixelTransform([120, 6, -9, -120, 900, 1500], 3),
    [40, 2, -3, -40, 300, 500]);
});

test('maps local context and clip into their matching coordinate spaces', () => {
  const context = {
    dimension: 2,
    originX: 4,
    originY: -3,
    basisXX: 2,
    basisXY: 0,
    basisYX: 0,
    basisYY: 2
  };
  assert.deepEqual(symbolicDataToScreenTransform(viewport, context),
    [64, 2, -4, -64, 434, 340]);
  assert.deepEqual(symbolicClipInLocalCoordinates([[4, -3], [6, -1]], context),
    [[0, 0], [1, 1]]);
});

test('adapts curve and field samples to pixel coverage', () => {
  const view = buildSymbolicPlotView(viewport);
  assert.equal(view.xSteps, 514);
  assert.equal(view.ySteps, 322);
  assert.equal(view.fieldXSteps, 17);
  assert.equal(view.fieldYSteps, 17);
});

test('extracts snap points and line segments from symbolic plot ranges', () => {
  const data = new Float32Array([
    1, 2, 0, 0, 0, 0,
    3, 4, 0, 0, 0, 0,
    5, 6, 0, 0, 0, 0,
    7, 8, 0, 0, 0, 0
  ]);
  const geometry = symbolicPlotSnapGeometry({
    data,
    ranges: [
      { topology: 'point-list', first: 0, count: 1 },
      { topology: 'line-strip', first: 1, count: 3 }
    ]
  });
  assert.deepEqual(geometry, {
    points: [[1, 2]],
    segments: [[[3, 4], [5, 6]], [[5, 6], [7, 8]]]
  });
  assert.ok(Object.isFrozen(geometry));
});

test('hit-tests plot geometry in CSS screen coordinates', () => {
  const geometry = { points: [], segments: [[[0, 0], [2, 0]]] };
  assert.deepEqual(hitTestSymbolicPlotGeometry(geometry, [10, 0, 0, -10, 100, 50], [110, 54], 5),
    { kind: 'segment', index: 0, distance: 4, closest: [110, 50] });
  assert.equal(hitTestSymbolicPlotGeometry(geometry, [10, 0, 0, -10, 100, 50], [110, 56], 5), null);
});

test('controller compiles, plots, renders, and exposes snap geometry', async () => {
  const calls = [];
  const memory = new WebAssembly.Memory({ initial: 1 });
  const vertices = new Float32Array(memory.buffer, 0, 12);
  vertices.set([1, 2, 0, 0, 0, 0, 3, 4, 0, 0, 0, 0]);
  const program = {
    diagnostics: [],
    latex: 'x^{2}',
    variables: ['x'],
    classification: 'y-of-x',
    valueKind: 'number'
  };
  const kernel = {
    memory,
    compileWithContext() { return { value: program }; },
    createWorkspace() { return { handle: 'workspace-0' }; },
    workspaceCompile(workspace, source, context, clip) {
      calls.push(['compile', workspace, source, context, clip]);
      return { value: { program }, workspace: 'workspace-1', program: 'program-1' };
    },
    plot(compiled, workspace, view, style, revision) {
      calls.push(['plot', compiled, workspace, view, style, revision]);
      return {
        pointer: 0,
        count: 2,
        stride: 24,
        revision,
        ranges: [{ topology: 'line-strip', mode: 'time-curve', first: 0, count: 2 }]
      };
    }
  };
  const renderer = {
    async initialize() { calls.push(['initialize']); },
    updateTransform(value) { calls.push(['transform', value]); },
    updateClip(value) { calls.push(['clip', value]); },
    updateAppearance(value) { calls.push(['appearance', value]); },
    setArena(value) { calls.push(['arena', value]); },
    render() { calls.push(['render']); },
    async pick(point, radius) { calls.push(['pick', point, radius]); return { kind: 'segment', index: 0 }; },
    resize() {},
    destroy() {}
  };
  const controller = await createSymbolicPlotController({
    canvas: { hidden: true },
    kernel,
    createRenderer: () => renderer
  });
  const result = await controller.plot({
    source: 'x^2',
    viewport: {
      ...viewport,
      transform: viewport.transform.map((value) => value * 2),
      pixelRatio: 2
    },
    colors: { edge: '#ffffff', face: 'rgba(255, 255, 255, 0.5)' },
    revision: 7
  });

  assert.equal(result.classification, 'y-of-x');
  assert.deepEqual(controller.snapGeometry.segments, [[[1, 2], [3, 4]]]);
  assert.equal(controller.hitTest([328, 177], 2)?.kind, 'segment');
  assert.deepEqual(await controller.pick([328, 177], 8), { kind: 'segment', index: 0 });
  assert.deepEqual(calls.find(([name]) => name === 'pick').slice(1), [[328, 177], 8]);
  controller.setInteractionState('selected');
  assert.deepEqual(calls.filter(([name]) => name === 'appearance').at(-1)[1].partStates, {
    edge: 'selected', face: 'selected'
  });
  assert.deepEqual(controller.setInteractionState({ edge: 'selected', face: 'hovered' }), {
    edge: 'selected', face: 'hovered'
  });
  assert.deepEqual(calls.filter(([name]) => name === 'appearance').at(-1)[1].partStates, {
    edge: 'selected', face: 'hovered'
  });
  assert.deepEqual(controller.setInteractionState('normal', 'edge'), {
    edge: 'normal', face: 'hovered'
  });
  assert.equal(calls.filter(([name]) => name === 'compile').length, 1);
  assert.equal(calls.filter(([name]) => name === 'plot').length, 1);
  assert.equal(calls.filter(([name]) => name === 'render').length, 4);
  assert.deepEqual(calls.find(([name]) => name === 'transform')[1], viewport.transform);

  controller.updateView({
    transform: viewport.transform.map((value) => value * 3),
    pixelRatio: 3
  });
  assert.deepEqual(calls.filter(([name]) => name === 'transform').at(-1)[1], viewport.transform);
  controller.resize(640, 480);
  assert.equal(controller.setVisible(false), false);
  assert.equal(controller.setVisible(true), true);
  controller.destroy();
  assert.throws(() => controller.updateView({ transform: viewport.transform }), /destroyed/);
});

test('keeps newer synchronous view frames when asynchronous sampling completes stale', async () => {
  const calls = [];
  const memory = new WebAssembly.Memory({ initial: 1 });
  let resolvePlot;
  const pendingArena = new Promise((resolve) => { resolvePlot = resolve; });
  const program = {
    diagnostics: [], latex: 'x', variables: ['x'], classification: 'y-of-x', valueKind: 'number'
  };
  const kernel = {
    memory,
    compileWithContext() { return { value: program }; },
    createWorkspace() { return { handle: 'workspace' }; },
    workspaceCompile() { return { value: { program }, workspace: 'next-workspace' }; },
    plot() { return pendingArena; }
  };
  const renderer = {
    async initialize() {},
    updateTransform(value) { calls.push(['transform', value]); },
    updateClip(value) { calls.push(['clip', value]); },
    updateAppearance() {},
    setArena(value) { calls.push(['arena', value]); },
    render() { calls.push(['render']); },
    async pick() { return null; },
    resize() {},
    destroy() {}
  };
  const controller = await createSymbolicPlotController({
    canvas: { hidden: true }, kernel, createRenderer: () => renderer
  });
  const oldTransform = [10, 0, 0, -10, 100, 100];
  const newestTransform = [20, 0, 0, -20, 200, 200];
  const stalePlot = controller.plot({
    source: 'x', viewport: { ...viewport, transform: oldTransform },
    colors: { edge: '#ffffff', face: '#00000080' }, frameRevision: 4
  });

  assert.equal(controller.updateView({ transform: newestTransform, frameRevision: 5 }), true);
  assert.equal(controller.frameRevision, 5);
  assert.equal(controller.updateView({ transform: oldTransform, frameRevision: 3 }), false);
  resolvePlot({ pointer: 0, count: 0, stride: 24, revision: 1, ranges: [] });
  assert.equal(await stalePlot, null);

  assert.deepEqual(calls.filter(([name]) => name === 'transform').map((call) => call[1]), [newestTransform]);
  assert.equal(calls.some(([name]) => name === 'arena'), false);
  assert.equal(calls.filter(([name]) => name === 'render').length, 1);
  await assert.rejects(() => controller.plot({
    source: 'x', viewport, colors: { edge: '#fff', face: '#fff' }, frameRevision: -1
  }), /frame revision/);
});

test('commits delayed temporal samples when only time advances in the same spatial view', async () => {
  const calls = [];
  const memory = new WebAssembly.Memory({ initial: 1 });
  const vertices = new Float32Array(memory.buffer, 0, 12);
  vertices.set([0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0]);
  let resolvePlot;
  const pendingArena = new Promise((resolve) => { resolvePlot = resolve; });
  const program = {
    diagnostics: [], latex: '\\sin(x-t)', variables: ['x', 't'],
    classification: 'y-of-x', valueKind: 'number'
  };
  const kernel = {
    memory,
    compileWithContext() { return { value: program }; },
    createWorkspace() { return { handle: 'workspace' }; },
    workspaceCompile() { return { value: { program }, workspace: 'next-workspace' }; },
    plot() { return pendingArena; }
  };
  const renderer = {
    async initialize() {},
    updateTransform(value) { calls.push(['transform', value]); },
    updateClip() {},
    updateAppearance() {},
    setArena(value) { calls.push(['arena', value]); },
    render() {},
    async pick() { return { kind: 'segment', index: 0 }; },
    resize() {},
    destroy() {}
  };
  const controller = await createSymbolicPlotController({
    canvas: { hidden: true }, kernel, createRenderer: () => renderer
  });
  const pending = controller.plot({
    source: 'sin(x-t)', viewport: { ...viewport, t: 0 },
    colors: { edge: '#ffffff', face: '#00000080' },
    frameRevision: 4, frameEpoch: 2
  });

  assert.equal(controller.updateView({
    transform: viewport.transform, frameRevision: 5, frameEpoch: 2
  }), true);
  resolvePlot({
    pointer: 0, count: 2, stride: 24, revision: 1,
    ranges: [{ topology: 'line-strip', mode: 'time-curve', first: 0, count: 2 }]
  });
  const result = await pending;

  assert.equal(result.frameRevision, 4);
  assert.equal(controller.frameRevision, 5);
  assert.equal(controller.frameEpoch, 2);
  assert.equal(calls.filter(([name]) => name === 'arena').length, 1);
  assert.equal(controller.hitTest([300, 240], 2)?.kind, 'segment');
  assert.deepEqual(await controller.pick([300, 240], 8), { kind: 'segment', index: 0 });
});

test('rejects delayed samples from an epoch before reset', async () => {
  const memory = new WebAssembly.Memory({ initial: 1 });
  let resolvePlot;
  const pendingArena = new Promise((resolve) => { resolvePlot = resolve; });
  const program = {
    diagnostics: [], latex: 'x-t', variables: ['x', 't'],
    classification: 'y-of-x', valueKind: 'number'
  };
  const arenas = [];
  const controller = await createSymbolicPlotController({
    canvas: { hidden: true },
    kernel: {
      memory,
      compileWithContext() { return { value: program }; },
      createWorkspace() { return { handle: 'workspace' }; },
      workspaceCompile() { return { value: { program }, workspace: 'next-workspace' }; },
      plot() { return pendingArena; }
    },
    createRenderer: () => ({
      async initialize() {}, updateTransform() {}, updateClip() {}, updateAppearance() {},
      setArena(value) { arenas.push(value); }, render() {}, async pick() { return null; },
      resize() {}, destroy() {}
    })
  });
  const pending = controller.plot({
    source: 'x-t', viewport: { ...viewport, t: 8 },
    colors: { edge: '#ffffff', face: '#00000080' },
    frameRevision: 9, frameEpoch: 1
  });

  assert.equal(controller.updateView({
    transform: viewport.transform, frameRevision: 10, frameEpoch: 2
  }), true);
  resolvePlot({ pointer: 0, count: 0, stride: 24, revision: 1, ranges: [] });

  assert.equal(await pending, null);
  assert.equal(arenas.length, 0);
  assert.equal(controller.frameEpoch, 2);
});
