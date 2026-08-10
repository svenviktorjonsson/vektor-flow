import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildSymbolicPlotView,
  createSymbolicCompiler,
  createSymbolicPlotController,
  globalSymbolicContext,
  hitTestSymbolicPlotGeometry,
  symbolicClipInLocalCoordinates,
  symbolicCssPixelTransform,
  symbolicDataToScreenTransform,
  symbolicPlotSeriesCount,
  colorSymbolicPlotSeries,
  symbolicPlotSnapGeometry
} from 'vektor-flow/symbolic-plot-controller';

test('global symbolic context defaults to one unindexed instance', () => {
  assert.equal(globalSymbolicContext().n, 0);
  assert.equal(globalSymbolicContext().N, 1);
});

const viewport = Object.freeze({
  xMin: -8,
  xMax: 8,
  yMin: -5,
  yMax: 5,
  transform: [32, 1, -2, -32, 300, 240]
});

test('compiler exposes plot capability only for supported classifications', async () => {
  let classification = 'definition';
  const kernel = {
    memory: new WebAssembly.Memory({ initial: 1 }),
    compileDraft: () => ({ value: { latex: '', complete: false, diagnostics: [] } }),
    compileWithContext: () => ({ value: {
      classification, diagnostics: [], latex: 'f(x)=x', variables: ['x']
    } }),
    createWorkspace: () => ({ handle: 'workspace-0' }),
    workspaceCompile: () => ({ workspace: 'workspace-0', value: {} }),
    plot: () => ({ data: new Float32Array(), count: 0, stride: 24, ranges: [] })
  };
  const compiler = await createSymbolicCompiler({ kernel });

  assert.equal(compiler.compile('f(x)=x').plottable, false);
  classification = 'y-of-x';
  assert.equal(compiler.compile('x^2').plottable, true);
  classification = 'y-of-x-family';
  assert.equal(compiler.compile('x^(1..4)').plottable, true);
});

test('owns a four-range curve family in one controller arena', async () => {
  const calls = [];
  const memory = new WebAssembly.Memory({ initial: 1 });
  const vertices = new Float32Array(memory.buffer, 0, 48);
  for (let curve = 0; curve < 4; curve += 1) {
    const offset = curve * 12;
    vertices.set([-1, (-1) ** (curve + 1), 0, 0, 0, 0, 1, 1, 0, 0, 0, 0], offset);
  }
  const program = {
    diagnostics: [],
    latex: '{x}^{\\left(1..4\\right)}',
    variables: ['x'],
    classification: 'y-of-x-family',
    valueKind: 'scalar'
  };
  const ranges = [0, 1, 2, 3].map((index) => ({
    topology: 'line-strip', mode: 'time-curve', first: index * 2, count: 2
  }));
  const kernel = {
    memory,
    compileWithContext() { return { value: program }; },
    createWorkspace() { return { handle: 'workspace-0' }; },
    workspaceCompile() { calls.push(['compile']); return { value: { program }, workspace: 'workspace-1', program: 'program-1' }; },
    plot() { calls.push(['plot']); return { pointer: 0, count: 8, stride: 24, revision: 1, ranges }; }
  };
  const renderer = {
    async initialize() {},
    updateTransform() {}, updateClip() {},
    updateAppearance(value) { calls.push(['appearance', value]); },
    setArena(value) { calls.push(['arena', value]); },
    render() {}, resize() {}, destroy() {},
    async pick() { calls.push(['pick']); return { kind: 'segment', rangeIndex: 2, index: 4 }; }
  };
  const canvas = { hidden: true };
  const controller = await createSymbolicPlotController({ canvas, kernel, createRenderer: () => renderer });
  const result = await controller.plot({
    source: 'x^(1..4)', viewport,
    colors: { edge: '#ffffff', face: 'rgba(255,255,255,0.5)' }, revision: 1
  });

  assert.equal(result.plottable, true);
  assert.equal(calls.filter(([name]) => name === 'compile').length, 1);
  assert.equal(calls.filter(([name]) => name === 'plot').length, 1);
  const arenas = calls.filter(([name]) => name === 'arena');
  assert.equal(arenas.length, 1);
  assert.deepEqual(arenas[0][1].ranges, ranges);
  assert.deepEqual(await controller.pick([0, 0]), { kind: 'segment', rangeIndex: 2, index: 4 });
  controller.setInteractionState('selected');
  assert.deepEqual(calls.filter(([name]) => name === 'appearance').at(-1)[1].partStates, {
    edge: 'selected', face: 'selected'
  });
  assert.equal(controller.toggleVisible(), false);
  assert.equal(canvas.hidden, true);
  controller.destroy();
});

test('renders a mixed document plot group in one GPU arena', async () => {
  const calls = [];
  const memory = new WebAssembly.Memory({ initial: 1 });
  new Float32Array(memory.buffer, 0, 24).set([
    -1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0,
    -1, -1, 0, 0, 0, 0, 1, -1, 0, 0, 0, 0
  ]);
  const members = [
    { diagnostics: [], variables: ['x'], classification: 'y-of-x', valueKind: 'scalar' },
    { diagnostics: [], variables: ['y'], classification: 'x-of-y', valueKind: 'scalar' }
  ];
  const aggregate = {
    diagnostics: [], variables: ['x', 'y'], classification: 'plot-group', valueKind: 'group'
  };
  let plotIndex = 0;
  const kernel = {
    memory,
    compileWithContext() { return { value: aggregate }; },
    createWorkspace() { return { handle: 'workspace-0' }; },
    workspaceCompile() { return { value: { program: aggregate }, workspace: 'workspace-0' }; },
    plot() {
      const index = plotIndex++;
      return {
        pointer: index * 48,
        count: 2,
        stride: 24,
        revision: 1,
        ranges: [{ topology: 'line-strip', first: 0, count: 2 }]
      };
    }
  };
  const renderer = {
    async initialize() {}, updateTransform() {}, updateClip() {}, updateAppearance() {},
    setAnalyticRelation() { return null; },
    setArena(arena) { calls.push(arena); }, render() {}, resize() {}, destroy() {}
  };
  const controller = await createSymbolicPlotController({
    canvas: { hidden: true }, kernel, createRenderer: () => renderer
  });
  const compilation = {
    value: { program: aggregate },
    workspace: 'workspace-0',
    document: { programs: members.map((program) => ({ program })) }
  };

  await controller.plot({
    source: 'Compare x^2 and y^2', viewport,
    colors: { edge: '#ffffff', face: 'rgba(255,255,255,0.5)' },
    compilation,
    revision: 1
  });

  assert.equal(plotIndex, 2);
  assert.equal(calls[0].count, 4);
  assert.deepEqual(calls[0].ranges.map(({ first, count }) => ({ first, count })), [
    { first: 0, count: 2 },
    { first: 2, count: 2 }
  ]);
});

test('routes every relation in a mixed document through one GPU relation group', async () => {
  let analyticInputs = null;
  let sampled = 0;
  const members = [
    { diagnostics: [], variables: ['x', 'y'], classification: 'implicit-curve', valueKind: 'relation', ast: { id: 1 } },
    { diagnostics: [], variables: ['x', 'y'], classification: 'closed-region', valueKind: 'relation', ast: { id: 2 } }
  ];
  const aggregate = { diagnostics: [], variables: ['x', 'y'], classification: 'plot-group', valueKind: 'group' };
  const renderer = {
    async initialize() {}, updateTransform() {}, updateClip() {}, updateAppearance() {},
    setAnalyticRelations(values) { analyticInputs = values; return { shader: true }; },
    setArena() {}, render() {}, resize() {}, destroy() {}
  };
  const controller = await createSymbolicPlotController({
    canvas: { hidden: true },
    kernel: {
      memory: new WebAssembly.Memory({ initial: 1 }),
      compileWithContext() { return { value: aggregate }; },
      createWorkspace() { return { handle: 'workspace-0' }; },
      workspaceCompile() { return { value: { program: aggregate }, workspace: 'workspace-0' }; },
      plot() { sampled += 1; throw new Error('sampled relation fallback must not run'); }
    },
    createRenderer: () => renderer
  });

  await controller.plot({
    source: 'x^2 = 1 and y^2 < 1', viewport,
    colors: { edge: '#ffffff', face: 'rgba(255,255,255,0.5)' },
    compilation: {
      value: { program: aggregate },
      workspace: 'workspace-0',
      document: { programs: members.map((program) => ({ program })) }
    },
    revision: 1
  });

  assert.deepEqual(analyticInputs.map(({ ast }) => ast.id), [1, 2]);
  assert.equal(sampled, 0);
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
  assert.deepEqual(symbolicClipInLocalCoordinates({
    outer: [[4, -3], [8, -3], [8, 1], [4, 1]],
    holes: [[[5, -2], [6, -2], [5, -1]]]
  }, context), {
    outer: [[0, 0], [2, 0], [2, 2], [0, 2]],
    holes: [[[0.5, 0.5], [1, 0.5], [0.5, 1]]]
  });
});

test('adapts curve and field samples to pixel coverage', () => {
  const view = buildSymbolicPlotView(viewport);
  assert.equal(view.xSteps, 514);
  assert.equal(view.ySteps, 322);
  assert.equal(view.fieldXSteps, 17);
  assert.equal(view.fieldYSteps, 17);
});

test('counts and colors ordered graph ranges across a shared label domain', () => {
  const compilation = {
    value: { program: { classification: 'y-of-x', variants: [{}, {}] } }
  };
  assert.equal(symbolicPlotSeriesCount(compilation), 2);

  const arena = {
    data: new Float32Array([
      0, 0, 1, 1, 1, 1,
      1, 1, 1, 1, 1, 1,
      2, 2, 1, 1, 1, 1,
      3, 3, 1, 1, 1, 1
    ]),
    count: 4,
    stride: 24,
    revision: 1,
    ranges: [
      { part: 'edge', first: 0, count: 2 },
      { part: 'edge', first: 2, count: 2 }
    ]
  };
  const colored = colorSymbolicPlotSeries(arena, [
    { pos: 0, color: [255, 0, 0], alpha: 1 },
    { pos: 1, color: [0, 0, 255], alpha: 1 }
  ], { offset: 1, total: 4 });

  assert.deepEqual(
    Array.from(colored.data.slice(2, 6)),
    Array.from(new Float32Array([2 / 3, 0, 1 / 3, 1]))
  );
  assert.deepEqual(
    Array.from(colored.data.slice(14, 18)),
    Array.from(new Float32Array([1 / 3, 0, 2 / 3, 1]))
  );
  assert.deepEqual(Array.from(arena.data.slice(2, 6)), [1, 1, 1, 1]);
});

test('anchors vector samples to the data grid without pan-relative resampling', () => {
  const first = buildSymbolicPlotView({
    ...viewport,
    xMin: -2.4, xMax: 2.4, yMin: -1.4, yMax: 1.4,
    gridXInterval: 1, gridYInterval: 1
  });
  const panned = buildSymbolicPlotView({
    ...viewport,
    xMin: -2.1, xMax: 2.7, yMin: -1.1, yMax: 1.7,
    gridXInterval: 1, gridYInterval: 1
  });

  assert.deepEqual(
    [first.fieldXMin, first.fieldYMin, first.fieldXSteps, first.fieldYSteps],
    [-2, -1, 5, 3]
  );
  assert.deepEqual(
    [panned.fieldXMin, panned.fieldYMin],
    [-2, -1]
  );
  assert.equal(first.vectorScale, 0.35);
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

test('skips non-finite discontinuity samples while hit-testing plot geometry', () => {
  const geometry = {
    points: [[Number.NaN, 1]],
    segments: [
      [[-1, 0], [Number.NaN, Number.NaN]],
      [[0, 0], [2, 0]]
    ]
  };

  assert.deepEqual(
    hitTestSymbolicPlotGeometry(geometry, [10, 0, 0, -10, 100, 50], [110, 54], 5),
    { kind: 'segment', index: 1, distance: 4, closest: [110, 50] }
  );
});

test('omits non-finite samples and discontinuity segments from snap geometry', () => {
  const data = new Float32Array([
    -1, 0, 0, 0, 0, 0,
    Number.NaN, Number.NaN, 0, 0, 0, 0,
    1, 0, 0, 0, 0, 0,
    2, 0, 0, 0, 0, 0
  ]);

  assert.deepEqual(symbolicPlotSnapGeometry({
    data,
    ranges: [{ topology: 'line-strip', first: 0, count: 4 }]
  }), {
    points: [],
    segments: [[[1, 0], [2, 0]]]
  });
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
  const clipRegion = {
    outer: [[0, 0], [4, 0], [4, 4], [0, 4]],
    holes: [[[1, 1], [2, 1], [1, 2]]]
  };
  const result = await controller.plot({
    source: 'x^2',
    clip: clipRegion,
    viewport: {
      ...viewport,
      transform: viewport.transform.map((value) => value * 2),
      pixelRatio: 2
    },
    colors: { edge: '#ffffff', face: 'rgba(255, 255, 255, 0.5)' },
    revision: 7
  });

  assert.equal(result.classification, 'y-of-x');
  assert.equal(result.plottable, true);
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
  assert.equal(calls.find(([name]) => name === 'compile')[4], clipRegion);
  assert.deepEqual(calls.find(([name]) => name === 'clip')[1], clipRegion);
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

test('routes relations directly to the GPU without invoking the sampled CPU plotter', async () => {
  let sampled = 0;
  const program = {
    diagnostics: [],
    latex: '\\sin(x) \\le \\cos(y)',
    variables: ['x', 'y'],
    classification: 'closed-region',
    valueKind: 'scalar',
    ast: {
      kind: 'binary', op: '<=',
      left: { kind: 'call', name: 'sin', args: [{ kind: 'variable', name: 'x' }] },
      right: { kind: 'call', name: 'cos', args: [{ kind: 'variable', name: 'y' }] }
    }
  };
  program.variants = [
    program.ast,
    { ...program.ast, right: { kind: 'number', value: 2 } }
  ];
  let analyticInput;
  const renderer = {
    async initialize() {},
    setAnalyticRelation(value) { analyticInput = value; return value; },
    updateTransform() {}, updateClip() {}, updateAppearance() {},
    setArena() {}, render() {}, resize() {}, destroy() {}, async pick() { return null; }
  };
  const controller = await createSymbolicPlotController({
    canvas: { hidden: false },
    kernel: {
      memory: new WebAssembly.Memory({ initial: 1 }),
      compileWithContext() {},
      createWorkspace() { return { handle: 1 }; },
      workspaceCompile() { return { value: { program }, workspace: 1 }; },
      plot() { sampled += 1; throw new Error('sampled relation fallback must not run'); }
    },
    createRenderer: () => renderer
  });
  const result = await controller.plot({
    source: 'sin(x)<=cos(y)', viewport, colors: { edge: '#ffffff', face: 'rgba(255,255,255,0.5)' }
  });
  assert.equal(result.classification, 'closed-region');
  assert.equal(sampled, 0);
  assert.deepEqual(analyticInput.variants, program.variants);
  assert.deepEqual(controller.snapGeometry, { points: [], segments: [] });
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

test('assigns a fresh GPU arena revision to every committed temporal sample', async () => {
  const memory = new WebAssembly.Memory({ initial: 1 });
  const vertices = new Float32Array(memory.buffer, 0, 12);
  const arenas = [];
  let sample = 0;
  const program = {
    diagnostics: [], latex: '\\sin(x-t)', variables: ['x', 't'],
    classification: 'y-of-x', valueKind: 'number'
  };
  const controller = await createSymbolicPlotController({
    canvas: { hidden: true },
    kernel: {
      memory,
      compileWithContext() { return { value: program }; },
      createWorkspace() { return { handle: 'workspace' }; },
      workspaceCompile() { return { value: { program }, workspace: 'next-workspace' }; },
      plot(_program, _workspace, _view, _style, revision) {
        sample += 1;
        vertices.set([sample, 0, 0, 0, 0, 0, sample + 1, 1, 0, 0, 0, 0]);
        return {
          pointer: 0, count: 2, stride: 24, revision,
          ranges: [{ topology: 'line-strip', mode: 'time-curve', first: 0, count: 2 }]
        };
      }
    },
    createRenderer: () => ({
      async initialize() {}, updateTransform() {}, updateClip() {}, updateAppearance() {},
      setArena(value) { arenas.push(value); }, render() {}, async pick() { return null; },
      resize() {}, destroy() {}
    })
  });
  const request = (t) => controller.plot({
    source: 'sin(x-t)', viewport: { ...viewport, t },
    colors: { edge: '#ffffff', face: '#00000080' },
    revision: 7, frameRevision: 4, frameEpoch: 2
  });

  await request(0);
  await request(1000);

  assert.equal(arenas.length, 2);
  assert.notEqual(arenas[0].revision, arenas[1].revision);
  assert.deepEqual(controller.snapGeometry.segments, [[[2, 0], [3, 1]]]);
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
