import { normalizeColorScale } from './vf-color-scale.mjs';
import { loadPackagedSymbolicKernel } from './vf-symbolic-kernel-runtime.mjs';
import { createSymbolicPlotRenderer } from './geom/vf-symbolic-plot-renderer.mjs';

const IDENTITY_AFFINE = Object.freeze([1, 0, 0, 1, 0, 0]);
const MIN_CURVE_STEPS = 65;
const MAX_CURVE_STEPS = 2049;
const MIN_FIELD_STEPS = 17;
const MAX_FIELD_STEPS = 17;
const FLOATS_PER_VERTEX = 6;

export async function createSymbolicPlotController({
  canvas,
  kernel: suppliedKernel = null,
  loadKernel = loadPackagedSymbolicKernel,
  createRenderer = createSymbolicPlotRenderer
}) {
  if (!canvas) throw new TypeError('symbolic plot requires a canvas');
  if (typeof loadKernel !== 'function') throw new TypeError('loadKernel must be a function');
  if (typeof createRenderer !== 'function') throw new TypeError('createRenderer must be a function');

  const [kernel, renderer] = await Promise.all([
    suppliedKernel || loadKernel(),
    initializeRenderer(createRenderer(canvas))
  ]);
  requireKernel(kernel);

  let workspace = kernel.createWorkspace().handle;
  let visible = true;
  let destroyed = false;
  let lastResult = null;
  let snapGeometry = symbolicPlotSnapGeometry(null);
  let dataToScreenTransform = [...IDENTITY_AFFINE];
  let interactionState = Object.freeze({ edge: 'normal', face: 'normal' });
  let latestViewRevision = null;
  let latestViewSpatialKey = null;
  let latestViewEpoch = 0;
  let plotRequestOrder = 0;
  let latestPlotRequest = null;
  let latestCommittedPlotOrder = 0;
  let latestCommittedPlotRevision = null;
  canvas.hidden = false;

  async function plot({
    source,
    context = globalSymbolicContext(),
    clip = null,
    viewport,
    colors,
    colormapPoints = null,
    colorScale = null,
    revision = 0,
    frameRevision = null,
    frameEpoch = 0,
    compilation = null
  }) {
    assertAlive();
    if (typeof source !== 'string') throw new TypeError('symbolic source must be a string');
    requireRecord(context, 'symbolic context');
    const requestedFrameRevision = normalizeFrameRevision(frameRevision);
    const requestedFrameEpoch = normalizeFrameEpoch(frameEpoch);
    const normalizedViewport = controllerViewport(viewport);
    const view = buildSymbolicPlotView(normalizedViewport, context);
    const style = buildSymbolicPlotStyle(colors, colormapPoints, colorScale);
    const transform = symbolicDataToScreenTransform(normalizedViewport, context);
    const localClip = symbolicClipInLocalCoordinates(clip, context);
    const viewSpatialKey = symbolicViewSpatialKey(transform, localClip);
    if (requestedFrameEpoch < latestViewEpoch) return lastResult;
    if (requestedFrameEpoch > latestViewEpoch) {
      latestViewEpoch = requestedFrameEpoch;
      latestViewRevision = requestedFrameRevision;
      latestViewSpatialKey = viewSpatialKey;
    } else if (
      isStaleFrameRevision(requestedFrameRevision, latestViewRevision)
      && viewSpatialKey !== latestViewSpatialKey
    ) {
      return lastResult;
    }
    const compatibilityKey = symbolicPlotCompatibilityKey({
      source, revision, context, view, style, transform, clip: localClip
    });
    const requestOrder = ++plotRequestOrder;
    latestPlotRequest = { order: requestOrder, compatibilityKey };
    const compiled = compilation || kernel.workspaceCompile(workspace, source, context, clip);
    const executionWorkspace = compiled.workspace || workspace;

    const program = compiled.value?.program ?? compiled.value;
    const result = publicProgramResult(program);
    const documentPrograms = Array.isArray(compilation?.document?.programs)
      ? compilation.document.programs.map(({ program: member }) => member).filter(Boolean)
      : null;
    const relationPrograms = (documentPrograms || [program])
      .filter((member) => isSymbolicRelation(member?.classification));
    const relationInputs = relationPrograms.map((member) => ({
      ast: member.ast,
      variants: member.variants,
      style,
      t: view.t
    }));
    const analyticRelation = typeof renderer.setAnalyticRelations === 'function'
      ? renderer.setAnalyticRelations(relationInputs)
      : renderer.setAnalyticRelation?.(relationInputs[0] || null);
    if (relationPrograms.length > 0 && !analyticRelation) {
      throw new Error('VKF GPU relation compiler does not support this expression');
    }
    let nextSnapGeometry;
    let nextArena;
    if (relationPrograms.length > 0 && relationPrograms.length === (documentPrograms || [program]).length) {
      nextSnapGeometry = symbolicPlotSnapGeometry(null);
      nextArena = emptyArena(requestOrder);
    } else if (result.diagnostics.length === 0) {
      const sampledPrograms = (documentPrograms || [program])
        .filter((member) => !isSymbolicRelation(member?.classification));
      const arenas = await Promise.all(sampledPrograms.map(async (member) =>
        snapshotSymbolicPlotArena(
          await kernel.plot(member, executionWorkspace, view, style, revision),
          kernel.memory,
          requestOrder
        )));
      nextArena = combineSymbolicPlotArenas(arenas, requestOrder);
      nextSnapGeometry = symbolicPlotSnapGeometry(nextArena);
    } else {
      nextSnapGeometry = symbolicPlotSnapGeometry(null);
      nextArena = emptyArena(requestOrder);
    }
    if (requestedFrameEpoch !== latestViewEpoch) return lastResult;
    if (
      viewSpatialKey !== latestViewSpatialKey
      && isStaleFrameRevision(requestedFrameRevision, latestViewRevision)
    ) return lastResult;
    if (
      latestPlotRequest.order > requestOrder
      && latestPlotRequest.compatibilityKey !== compatibilityKey
    ) return lastResult;
    if (requestOrder < latestCommittedPlotOrder) return lastResult;
    if (latestViewRevision == null || (
      requestedFrameRevision != null && requestedFrameRevision >= latestViewRevision
    )) {
      latestViewRevision = requestedFrameRevision;
      latestViewSpatialKey = viewSpatialKey;
    }
    latestCommittedPlotOrder = requestOrder;
    latestCommittedPlotRevision = requestedFrameRevision;
    if (!compilation) workspace = executionWorkspace;
    dataToScreenTransform = [...transform];
    renderer.updateTransform(transform);
    renderer.updateClip(localClip);
    snapGeometry = nextSnapGeometry;
    renderer.setArena(nextArena);
    if (visible) renderer.render();

    lastResult = Object.freeze({
      ...result,
      source,
      context,
      clip,
      view,
      style,
      colorScale: publicColorScale(style),
      revision,
      frameRevision: requestedFrameRevision,
      frameEpoch: requestedFrameEpoch
    });
    return lastResult;
  }

  function updateView({
    transform,
    pixelRatio = 1,
    context = globalSymbolicContext(),
    clip = null,
    frameRevision = null,
    frameEpoch = 0
  }) {
    assertAlive();
    const requestedFrameRevision = normalizeFrameRevision(frameRevision);
    const requestedFrameEpoch = normalizeFrameEpoch(frameEpoch);
    const cssTransform = symbolicCssPixelTransform(transform, pixelRatio);
    const nextTransform = symbolicDataToScreenTransform({ transform: cssTransform }, context);
    const localClip = symbolicClipInLocalCoordinates(clip, context);
    const spatialKey = symbolicViewSpatialKey(nextTransform, localClip);
    if (requestedFrameEpoch < latestViewEpoch) return false;
    if (requestedFrameEpoch > latestViewEpoch) {
      latestViewEpoch = requestedFrameEpoch;
      latestViewRevision = requestedFrameRevision;
      latestViewSpatialKey = spatialKey;
    } else {
      if (
        isStaleFrameRevision(requestedFrameRevision, latestViewRevision)
        && spatialKey !== latestViewSpatialKey
      ) return false;
      if (latestViewRevision == null || (
        requestedFrameRevision != null && requestedFrameRevision >= latestViewRevision
      )) {
        latestViewRevision = requestedFrameRevision;
        latestViewSpatialKey = spatialKey;
      }
    }
    dataToScreenTransform = nextTransform;
    renderer.updateTransform(dataToScreenTransform);
    renderer.updateClip(localClip);
    if (visible) renderer.render();
    return true;
  }

  function resize(width, height) {
    assertAlive();
    renderer.resize(width, height);
    if (visible) renderer.render();
  }

  function setVisible(nextVisible) {
    assertAlive();
    const next = Boolean(nextVisible);
    if (next === visible) return visible;
    visible = next;
    canvas.hidden = !visible;
    if (visible) renderer.render();
    return visible;
  }

  function setInteractionState(state = 'normal', target = null) {
    assertAlive();
    const targetPart = ['face', 'edge'].includes(target?.part) ? target.part
      : ['face', 'edge'].includes(target) ? target
        : null;
    let next;
    if (state && typeof state === 'object' && !Array.isArray(state)) {
      next = Object.freeze({
        edge: normalizePartInteractionState(state.edge),
        face: normalizePartInteractionState(state.face)
      });
    } else if (targetPart) {
      next = Object.freeze({
        ...interactionState,
        [targetPart]: normalizePartInteractionState(state)
      });
    } else {
      const scalar = normalizePartInteractionState(state);
      next = Object.freeze({ edge: scalar, face: scalar });
    }
    if (next.edge === interactionState.edge && next.face === interactionState.face) return interactionState;
    interactionState = next;
    renderer.updateAppearance({ partStates: interactionState });
    if (visible) renderer.render();
    return interactionState;
  }

  function hitTest(screenPoint, radius = 7) {
    assertAlive();
    return hitTestSymbolicPlotGeometry(snapGeometry, dataToScreenTransform, screenPoint, radius);
  }

  async function pick(screenPoint, radius = 7) {
    assertAlive();
    if (!visible) return null;
    return renderer.pick(screenPoint, radius);
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    renderer.destroy();
  }

  function assertAlive() {
    if (destroyed) throw new Error('symbolic plot controller is destroyed');
  }

  return Object.freeze({
    plot,
    updateView,
    resize,
    setVisible,
    setInteractionState,
    hitTest,
    pick,
    toggleVisible() {
      return setVisible(!visible);
    },
    destroy,
    get visible() {
      return visible;
    },
    get result() {
      return lastResult;
    },
    get snapGeometry() {
      return snapGeometry;
    },
    get frameRevision() {
      return latestViewRevision;
    },
    get frameEpoch() {
      return latestViewEpoch;
    },
    get committedPlotRevision() {
      return latestCommittedPlotRevision;
    }
  });
}

function symbolicViewSpatialKey(transform, clip) {
  return compatibilityKey([transform, clip]);
}

function symbolicPlotCompatibilityKey({ source, revision, context, view, style, transform, clip }) {
  return compatibilityKey([
    source,
    revision,
    context,
    clip,
    transform,
    {
      xMin: view.xMin,
      xMax: view.xMax,
      yMin: view.yMin,
      yMax: view.yMax,
      xSteps: view.xSteps,
      ySteps: view.ySteps,
      fieldXSteps: view.fieldXSteps,
      fieldYSteps: view.fieldYSteps,
      tMin: view.tMin,
      tMax: view.tMax,
      tSteps: view.tSteps,
      vectorScale: view.vectorScale
    },
    style
  ]);
}

function compatibilityKey(value) {
  return JSON.stringify(canonicalCompatibilityValue(value));
}

function canonicalCompatibilityValue(value) {
  if (Array.isArray(value) || ArrayBuffer.isView(value)) {
    return Array.from(value, canonicalCompatibilityValue);
  }
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().map((key) => [key, canonicalCompatibilityValue(value[key])]);
  }
  return Object.is(value, -0) ? 0 : value;
}

function normalizeFrameRevision(value) {
  if (value == null) return null;
  const revision = Number(value);
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new RangeError('symbolic frame revision must be a non-negative safe integer');
  }
  return revision;
}

function normalizeFrameEpoch(value) {
  const epoch = Number(value);
  if (!Number.isSafeInteger(epoch) || epoch < 0) {
    throw new RangeError('symbolic frame epoch must be a non-negative safe integer');
  }
  return epoch;
}

function isStaleFrameRevision(requested, latest) {
  return requested != null && latest != null && requested < latest;
}

function normalizePartInteractionState(value) {
  return ['hovered', 'selected'].includes(value) ? value : 'normal';
}

function isSymbolicRelation(classification) {
  return ['implicit-curve', 'open-region', 'closed-region'].includes(classification);
}

export function hitTestSymbolicPlotGeometry(geometry, transform, screenPoint, radius = 7) {
  if (!geometry || (!Array.isArray(screenPoint) && !ArrayBuffer.isView(screenPoint))) return null;
  const point = [finite(screenPoint[0], 'plot hit x'), finite(screenPoint[1], 'plot hit y')];
  const hitRadius = finite(radius, 'plot hit radius');
  if (hitRadius < 0) throw new RangeError('plot hit radius must be non-negative');
  const affine = normalizeAffine(transform);
  let best = null;
  const consider = (candidate, kind, index) => {
    if (candidate.distance > hitRadius || (best && candidate.distance >= best.distance)) return;
    best = Object.freeze({ kind, index, distance: candidate.distance, closest: Object.freeze(candidate.closest) });
  };
  for (const [index, value] of (geometry.points || []).entries()) {
    const screen = applyAffine(affine, value);
    consider({ distance: Math.hypot(point[0] - screen[0], point[1] - screen[1]), closest: screen }, 'point', index);
  }
  for (const [index, segment] of (geometry.segments || []).entries()) {
    const from = applyAffine(affine, segment[0]);
    const to = applyAffine(affine, segment[1]);
    consider(distanceToSegment(point, from, to), 'segment', index);
  }
  return best;
}

function distanceToSegment(point, from, to) {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const lengthSquared = dx * dx + dy * dy;
  const projection = lengthSquared > 0
    ? Math.max(0, Math.min(1, ((point[0] - from[0]) * dx + (point[1] - from[1]) * dy) / lengthSquared))
    : 0;
  const closest = [from[0] + projection * dx, from[1] + projection * dy];
  return { closest, distance: Math.hypot(point[0] - closest[0], point[1] - closest[1]) };
}

function controllerViewport(viewport) {
  requireRecord(viewport, 'symbolic viewport');
  return Object.freeze({
    ...viewport,
    transform: symbolicCssPixelTransform(viewport.transform ?? IDENTITY_AFFINE, viewport.pixelRatio ?? 1)
  });
}

export function symbolicPlotSnapGeometry(arena) {
  if (!arena || !(arena.data instanceof Float32Array)) return emptySnapGeometry();
  const points = [];
  const segments = [];
  const canonicalPoints = new Map();
  const canonicalPoint = (value) => {
    const point = freezePoint(value);
    const key = `${point[0]},${point[1]}`;
    const existing = canonicalPoints.get(key);
    if (existing) return existing;
    canonicalPoints.set(key, point);
    return point;
  };
  for (const range of arena.ranges || []) {
    const topology = symbolicSnapTopology(range);
    if (topology === 'point-list') {
      for (let index = 0; index < range.count; index += 1) {
        const point = canonicalPoint(vertexAt(arena.data, range.first + index));
        if (!points.includes(point)) points.push(point);
      }
    } else if (topology === 'line-list') {
      for (let index = 0; index + 1 < range.count; index += 2) {
        segments.push([
          canonicalPoint(vertexAt(arena.data, range.first + index)),
          canonicalPoint(vertexAt(arena.data, range.first + index + 1))
        ]);
      }
    } else if (topology === 'line-strip') {
      for (let index = 0; index + 1 < range.count; index += 1) {
        segments.push([
          canonicalPoint(vertexAt(arena.data, range.first + index)),
          canonicalPoint(vertexAt(arena.data, range.first + index + 1))
        ]);
      }
    }
  }
  return Object.freeze({
    points: Object.freeze(points),
    segments: Object.freeze(segments.map(([from, to]) => Object.freeze([from, to])))
  });
}

function symbolicSnapTopology(range) {
  if (range?.topology) return range.topology;
  if (range?.mode === 'points') return 'point-list';
  if (range?.mode === 'linked-line-segments' || range?.mode === 'vector-field-glyphs') {
    return 'line-list';
  }
  if (range?.mode === 'time-curve') return 'line-strip';
  return null;
}

export async function createSymbolicCompiler({
  kernel: suppliedKernel = null,
  loadKernel = loadPackagedSymbolicKernel
} = {}) {
  const kernel = suppliedKernel || await loadKernel();
  requireKernel(kernel);
  if (typeof kernel.compileDraft !== 'function') {
    throw new TypeError('symbolic compiler kernel must provide compileDraft');
  }
  let workspace = kernel.createWorkspace().handle;

  return Object.freeze({
    preview(source) {
      return publicDraftResult(kernel.compileDraft(String(source ?? '')).value);
    },
    compile(source, context = globalSymbolicContext(), clip = null) {
      const result = kernel.compileWithContext(String(source ?? ''), context, clip);
      return publicProgramResult(result.value?.program ?? result.value);
    },
    compileDocument(source, {
      profile = 'default',
      context = globalSymbolicContext(),
      clip = null
    } = {}) {
      const compiled = kernel.compileDocument(String(source ?? ''), profile, context, clip);
      return publicDocumentResult(compiled.value, compiled.program);
    },
    compileDocumentPrograms(source, options = {}) {
      return this.compileDocument(source, options).programs;
    },
    compileDocumentProgram(source, {
      profile = 'default',
      context = globalSymbolicContext(),
      clip = null
    } = {}) {
      const compiled = kernel.compileDocument(String(source ?? ''), profile, context, clip);
      const document = publicDocumentResult(compiled.value, compiled.program);
      const program = compiled.value?.program ?? null;
      return Object.freeze({
        value: Object.freeze({ program }),
        program: compiled.program,
        workspace,
        document,
        result: publicProgramResult(program)
      });
    },
    compileProgram(source, context = globalSymbolicContext(), clip = null) {
      const compiled = kernel.workspaceCompile(workspace, String(source ?? ''), context, clip);
      workspace = compiled.workspace;
      return Object.freeze({
        ...compiled,
        result: publicProgramResult(compiled.value?.program ?? compiled.value)
      });
    }
  });
}

export function createSymbolicEditorSession({
  compiler,
  source = '',
  context = globalSymbolicContext(),
  clip = null
} = {}) {
  if (typeof compiler?.preview !== 'function' || typeof compiler?.compileProgram !== 'function') {
    throw new TypeError('symbolic editor compiler must provide preview and compileProgram');
  }

  let editing = false;
  let committedSource = '';
  let committedLatex = '';
  let program = null;
  let draftSource = String(source ?? '');
  let draft = compiler.preview(draftSource);

  if (draft.complete) commit(draftSource, draft);

  function commit(nextSource, nextDraft) {
    program = compiler.compileProgram(nextSource, context, clip);
    committedSource = nextSource;
    committedLatex = nextDraft.latex;
  }

  function snapshot() {
    const visibleSource = editing ? draftSource : committedSource;
    const visibleLatex = editing ? draft.latex : committedLatex;
    return Object.freeze({
      editing,
      source: visibleSource,
      latex: visibleLatex,
      complete: editing ? draft.complete : program !== null,
      recoverable: editing ? draft.recoverable : true,
      diagnostics: editing ? draft.diagnostics : Object.freeze([]),
      committedSource,
      committedLatex,
      program
    });
  }

  return Object.freeze({
    snapshot,
    open() {
      editing = true;
      draftSource = committedSource;
      draft = compiler.preview(draftSource);
      return snapshot();
    },
    update(nextSource) {
      if (!editing) throw new Error('symbolic editor session must be open before updating');
      draftSource = String(nextSource ?? '');
      draft = compiler.preview(draftSource);
      if (draft.complete) commit(draftSource, draft);
      return snapshot();
    },
    cancel() {
      editing = false;
      draftSource = committedSource;
      draft = compiler.preview(draftSource);
      return snapshot();
    }
  });
}

export function globalSymbolicContext() {
  return Object.freeze({
    kind: 'global',
    dimension: 2,
    originX: 0,
    originY: 0,
    basisXX: 1,
    basisXY: 0,
    basisYX: 0,
    basisYY: 1
  });
}

export function symbolicCssPixelTransform(transform, pixelRatio = 1) {
  const affine = normalizeAffine(transform);
  const ratio = finite(pixelRatio, 'symbolic pixel ratio');
  if (ratio <= 0) throw new RangeError('symbolic pixel ratio must be positive');
  return Object.freeze(affine.map((value) => value / ratio));
}

export function buildSymbolicPlotView(viewport, context = globalSymbolicContext()) {
  requireRecord(viewport, 'symbolic viewport');
  const { xMin, xMax, yMin, yMax } = symbolicLocalViewportBounds(viewport, context);
  const transform = symbolicDataToScreenTransform(viewport, context);
  const xPixels = Math.hypot(transform[0], transform[1]) * (xMax - xMin);
  const yPixels = Math.hypot(transform[2], transform[3]) * (yMax - yMin);
  const xSteps = sampleSteps(xPixels, MIN_CURVE_STEPS, MAX_CURVE_STEPS, 1);
  const ySteps = sampleSteps(yPixels, MIN_CURVE_STEPS, MAX_CURVE_STEPS, 1);

  return Object.freeze({
    xMin,
    xMax,
    yMin,
    yMax,
    xSteps,
    ySteps,
    fieldXSteps: sampleSteps(xPixels, MIN_FIELD_STEPS, MAX_FIELD_STEPS, 12),
    fieldYSteps: sampleSteps(yPixels, MIN_FIELD_STEPS, MAX_FIELD_STEPS, 12),
    tMin: finite(viewport.tMin ?? xMin, 'viewport.tMin'),
    tMax: finite(viewport.tMax ?? xMax, 'viewport.tMax'),
    tSteps: Math.max(xSteps, ySteps),
    t: finite(viewport.t ?? 0, 'viewport.t'),
    vectorScale: finite(viewport.vectorScale ?? 0.35, 'viewport.vectorScale')
  });
}

export function symbolicDataToScreenTransform(viewport, context = globalSymbolicContext()) {
  return Object.freeze(composeAffine(affineFromViewport(viewport), symbolicContextAffine(context)));
}

export function symbolicLocalViewportBounds(viewport, context = globalSymbolicContext()) {
  const xMin = finite(viewport.xMin, 'viewport.xMin');
  const xMax = finite(viewport.xMax, 'viewport.xMax');
  const yMin = finite(viewport.yMin, 'viewport.yMin');
  const yMax = finite(viewport.yMax, 'viewport.yMax');
  if (xMax <= xMin || yMax <= yMin) {
    throw new RangeError('symbolic viewport ranges must be increasing');
  }
  const inverse = invertAffine(symbolicContextAffine(context));
  const corners = [
    applyAffine(inverse, [xMin, yMin]),
    applyAffine(inverse, [xMax, yMin]),
    applyAffine(inverse, [xMax, yMax]),
    applyAffine(inverse, [xMin, yMax])
  ];
  return Object.freeze({
    xMin: Math.min(...corners.map(([x]) => x)),
    xMax: Math.max(...corners.map(([x]) => x)),
    yMin: Math.min(...corners.map(([, y]) => y)),
    yMax: Math.max(...corners.map(([, y]) => y))
  });
}

export function symbolicClipInLocalCoordinates(clip, context = globalSymbolicContext()) {
  if (clip == null) return null;
  const inverse = invertAffine(symbolicContextAffine(context));
  const transformPolygon = (polygon, label) => {
    if (!Array.isArray(polygon)) throw new TypeError(label + ' must be a polygon');
    return Object.freeze(polygon.map((point) => applyAffine(inverse, point)));
  };
  if (Array.isArray(clip)) return transformPolygon(clip, 'symbolic clip');
  if (!clip || typeof clip !== 'object') {
    throw new TypeError('symbolic clip must be a polygon or region');
  }
  const holes = clip.holes ?? [];
  if (!Array.isArray(holes)) throw new TypeError('symbolic clip region holes must be an array');
  return Object.freeze({
    outer: transformPolygon(clip.outer, 'symbolic clip region outer'),
    holes: Object.freeze(holes.map((polygon) => transformPolygon(
      polygon,
      'symbolic clip region hole'
    )))
  });
}

export function buildSymbolicPlotStyle(colors, colormapPoints = null, colorScale = null) {
  requireRecord(colors, 'symbolic colors');
  const edge = normalizeColor(colors.edge, 'colors.edge');
  const face = normalizeColor(colors.face, 'colors.face');
  const scale = normalizeColorScale({
    domain: colorScale?.domain ?? [colors.valueMin ?? 0, colors.valueMax ?? 1],
    magnitudeDomain: colorScale?.magnitudeDomain
      ?? [colors.magnitudeMin ?? 0, colors.magnitudeMax ?? 1],
    mode: colorScale?.mode ?? colors.colorScaleMode
  });
  return Object.freeze({
    edgeR: edge[0], edgeG: edge[1], edgeB: edge[2], edgeA: edge[3],
    faceR: face[0], faceG: face[1], faceB: face[2], faceA: face[3],
    valueMin: scale.domain[0],
    valueMax: scale.domain[1],
    magnitudeMin: scale.magnitudeDomain[0],
    magnitudeMax: scale.magnitudeDomain[1],
    colorScaleMode: scale.mode,
    colormapPoints: normalizeColormapPoints(colormapPoints)
  });
}

function publicColorScale(style) {
  return Object.freeze({
    domain: Object.freeze([style.valueMin, style.valueMax]),
    magnitudeDomain: Object.freeze([style.magnitudeMin, style.magnitudeMax]),
    mode: style.colorScaleMode
  });
}

async function initializeRenderer(renderer) {
  if (!renderer || typeof renderer.initialize !== 'function') {
    throw new TypeError('symbolic renderer must provide initialize');
  }
  await renderer.initialize();
  return renderer;
}

function requireKernel(kernel) {
  for (const method of ['compileWithContext', 'createWorkspace', 'workspaceCompile', 'plot']) {
    if (typeof kernel?.[method] !== 'function') throw new TypeError(`symbolic kernel must provide ${method}`);
  }
  if (!(kernel.memory instanceof WebAssembly.Memory)) {
    throw new TypeError('symbolic kernel must expose WebAssembly memory');
  }
}

function publicDraftResult(draft) {
  return Object.freeze({
    latex: publicLatex(draft?.latex),
    complete: draft?.complete === true,
    recoverable: draft?.recoverable === true,
    diagnostics: Object.freeze(Array.isArray(draft?.diagnostics) ? [...draft.diagnostics] : [])
  });
}

function publicProgramResult(program) {
  const diagnostics = Object.freeze(
    Array.isArray(program?.diagnostics) ? [...program.diagnostics] : []
  );
  const classification = typeof program?.classification === 'string'
    ? program.classification
    : 'invalid';
  return Object.freeze({
    diagnostics,
    latex: publicLatex(program?.latex),
    variables: Object.freeze(Array.isArray(program?.variables)
      ? program.variables.filter((name) => typeof name === 'string')
      : []),
    classification,
    plottable: diagnostics.length === 0 && PLOTTABLE_CLASSIFICATIONS.has(classification),
    valueKind: typeof program?.valueKind === 'string' ? program.valueKind : 'invalid'
  });
}

function publicDocumentResult(document, retainedProgram = null) {
  const programs = Object.freeze((Array.isArray(document?.programs) ? document.programs : [])
    .map((entry) => Object.freeze({
      source: typeof entry?.source === 'string' ? entry.source : '',
      start: Number(entry?.start) || 0,
      end: Number(entry?.end) || 0,
      program: entry?.program,
      result: publicProgramResult(entry?.program)
    })));
  const spans = Object.freeze((Array.isArray(document?.spans) ? document.spans : [])
    .map((span) => Object.freeze({
      ...span,
      latex: publicLatex(span?.latex),
      roles: Object.freeze(Array.isArray(span?.roles) ? [...span.roles] : [])
    })));
  const diagnostics = Object.freeze(
    Array.isArray(document?.diagnostics) ? [...document.diagnostics] : []
  );
  return Object.freeze({
    source: typeof document?.source === 'string' ? document.source : '',
    latex: publicLatex(document?.latex),
    spans,
    programs,
    program: retainedProgram,
    result: publicProgramResult(document?.program),
    diagnostics,
    complete: document?.complete === true,
    recoverable: document?.recoverable === true,
    plottable: document?.plottable === true && programs.some(({ result }) => result.plottable)
  });
}

function publicLatex(latex) {
  if (typeof latex !== 'string') return '';
  return latex.replace(
    /(\\(?:sin|cos|tan)|\\operatorname\{[^{}]+\})\\left\(/g,
    '$1\\mkern-3mu\\left('
  );
}

const PLOTTABLE_CLASSIFICATIONS = new Set([
  'literal',
  'linked-tuple',
  'point-set',
  'y-of-x-family',
  'x-of-y-family',
  'y-of-x',
  'x-of-y',
  'parametric',
  'vector-field',
  'complex-field',
  'scalar-field',
  'implicit-curve',
  'open-region',
  'closed-region',
  'plot-group'
]);

function emptyArena(revision) {
  return { data: new Float32Array(), count: 0, stride: 24, revision, ranges: [] };
}

function arenaView(arena, memory) {
  return {
    data: arena.data instanceof Float32Array
      ? arena.data
      : new Float32Array(
          memory.buffer,
          arena.pointer,
          arena.count * arena.stride / Float32Array.BYTES_PER_ELEMENT
        ),
    ranges: arena.ranges
  };
}

function snapshotSymbolicPlotArena(arena, memory, revision) {
  const view = arenaView(arena, memory);
  return Object.freeze({
    data: new Float32Array(view.data),
    count: arena.count,
    stride: arena.stride,
    revision,
    ranges: Object.freeze(view.ranges.map((range) => Object.freeze({ ...range })))
  });
}

function combineSymbolicPlotArenas(arenas, revision) {
  if (arenas.length === 0) return emptyArena(revision);
  if (arenas.length === 1) return arenas[0];
  const stride = arenas[0].stride;
  if (arenas.some((arena) => arena.stride !== stride)) {
    throw new Error('VKF symbolic plot group has inconsistent vertex strides');
  }
  const data = new Float32Array(arenas.reduce((total, arena) => total + arena.data.length, 0));
  const ranges = [];
  let dataOffset = 0;
  let vertexOffset = 0;
  for (const arena of arenas) {
    data.set(arena.data, dataOffset);
    ranges.push(...arena.ranges.map((range) => Object.freeze({
      ...range,
      first: range.first + vertexOffset
    })));
    dataOffset += arena.data.length;
    vertexOffset += arena.count;
  }
  return Object.freeze({
    data,
    count: vertexOffset,
    stride,
    revision,
    ranges: Object.freeze(ranges)
  });
}

function vertexAt(data, index) {
  const offset = index * FLOATS_PER_VERTEX;
  return [Number(data[offset]), Number(data[offset + 1])];
}

function freezePoint(point) {
  return Object.freeze([...point].map((coordinate) => (
    Object.is(coordinate, -0) ? 0 : coordinate
  )));
}

function emptySnapGeometry() {
  return Object.freeze({ points: Object.freeze([]), segments: Object.freeze([]) });
}

function affineFromViewport(viewport) {
  return normalizeAffine(viewport.transform ?? IDENTITY_AFFINE);
}

function symbolicContextAffine(context) {
  requireRecord(context, 'symbolic context');
  return normalizeAffine([
    context.basisXX ?? 1, context.basisXY ?? 0,
    context.basisYX ?? 0, context.basisYY ?? 1,
    context.originX ?? 0, context.originY ?? 0
  ]);
}

function composeAffine(outer, inner) {
  const [a, b, c, d, e, f] = outer;
  const [g, h, i, j, k, l] = inner;
  return [
    a * g + c * h, b * g + d * h,
    a * i + c * j, b * i + d * j,
    a * k + c * l + e, b * k + d * l + f
  ];
}

function invertAffine([a, b, c, d, e, f]) {
  const determinant = a * d - b * c;
  if (Math.abs(determinant) < 1e-12) {
    throw new RangeError('symbolic coordinate context must be invertible');
  }
  return [
    d / determinant, -b / determinant, -c / determinant, a / determinant,
    (c * f - d * e) / determinant, (b * e - a * f) / determinant
  ];
}

function applyAffine(value, point) {
  if ((!Array.isArray(point) && !ArrayBuffer.isView(point)) || point.length < 2) {
    throw new TypeError('symbolic point must contain x and y');
  }
  const x = finite(point[0], 'symbolic point x');
  const y = finite(point[1], 'symbolic point y');
  return [
    value[0] * x + value[2] * y + value[4],
    value[1] * x + value[3] * y + value[5]
  ];
}

function sampleSteps(pixelSpan, minimum, maximum, pixelsPerSample) {
  return Math.max(minimum, Math.min(maximum,
    Math.ceil(Math.max(1, pixelSpan) / pixelsPerSample) + 1));
}

function normalizeAffine(value) {
  if ((!Array.isArray(value) && !ArrayBuffer.isView(value)) || value.length !== 6) {
    throw new TypeError('symbolic affine transform must contain six values');
  }
  const affine = Array.from(value, Number);
  if (!affine.every(Number.isFinite)) throw new TypeError('symbolic affine transform values must be finite');
  return Object.freeze(affine);
}

function normalizeColor(value, label) {
  if (typeof value === 'string') return parseCssColor(value, label);
  if (Array.isArray(value) || ArrayBuffer.isView(value)) {
    if (value.length < 3 || value.length > 4) throw new TypeError(`${label} must contain three or four channels`);
    const channels = Array.from(value, Number);
    if (!channels.every(Number.isFinite)) throw new TypeError(`${label} channels must be finite`);
    const scale = channels.slice(0, 3).some((channel) => channel > 1) ? 255 : 1;
    return Object.freeze([
      ...channels.slice(0, 3).map((channel) => clampUnit(channel / scale)),
      clampUnit(channels[3] ?? 1)
    ]);
  }
  if (value && typeof value === 'object') {
    const scale = [value.r, value.g, value.b].some((channel) => Number(channel) > 1) ? 255 : 1;
    return Object.freeze([
      clampUnit(finite(value.r, `${label}.r`) / scale),
      clampUnit(finite(value.g, `${label}.g`) / scale),
      clampUnit(finite(value.b, `${label}.b`) / scale),
      clampUnit(finite(value.a ?? 1, `${label}.a`))
    ]);
  }
  throw new TypeError(`${label} must be a color`);
}

function parseCssColor(value, label) {
  const hex = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(value);
  if (hex) {
    return Object.freeze([
      Number.parseInt(hex[1].slice(0, 2), 16) / 255,
      Number.parseInt(hex[1].slice(2, 4), 16) / 255,
      Number.parseInt(hex[1].slice(4, 6), 16) / 255,
      hex[2] ? Number.parseInt(hex[2], 16) / 255 : 1
    ]);
  }
  const rgba = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/i.exec(value);
  if (rgba) {
    return Object.freeze([
      clampUnit(Number(rgba[1]) / 255), clampUnit(Number(rgba[2]) / 255),
      clampUnit(Number(rgba[3]) / 255), clampUnit(rgba[4] == null ? 1 : Number(rgba[4]))
    ]);
  }
  throw new TypeError(`${label} must use #rrggbb, #rrggbbaa, rgb(), or rgba()`);
}

function normalizeColormapPoints(points) {
  if (points == null) return null;
  if (!Array.isArray(points)) throw new TypeError('colormap points must be an array');
  return Object.freeze(points.map((point, index) => {
    requireRecord(point, `colormapPoints[${index}]`);
    if (!Array.isArray(point.color) || point.color.length < 3) {
      throw new TypeError(`colormapPoints[${index}].color must contain RGB channels`);
    }
    return Object.freeze({
      pos: clampUnit(finite(point.pos, `colormapPoints[${index}].pos`)),
      color: Object.freeze(point.color.slice(0, 3).map((channel, channelIndex) =>
        clampByte(finite(channel, `colormapPoints[${index}].color[${channelIndex}]`)))),
      alpha: clampUnit(finite(point.alpha ?? 1, `colormapPoints[${index}].alpha`)),
      order: finite(point.order ?? 1, `colormapPoints[${index}].order`)
    });
  }));
}

function requireRecord(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
}

function finite(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError(`${label} must be finite`);
  return number;
}

function clampUnit(value) {
  return Math.max(0, Math.min(1, value));
}

function clampByte(value) {
  return Math.max(0, Math.min(255, value));
}
