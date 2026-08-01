import { loadPackagedSymbolicKernel } from './vf-symbolic-kernel-runtime.mjs';
import { createSymbolicPlotRenderer } from './geom/vf-symbolic-plot-renderer.mjs';

const IDENTITY_AFFINE = Object.freeze([1, 0, 0, 1, 0, 0]);
const MIN_CURVE_STEPS = 65;
const MAX_CURVE_STEPS = 2049;
const MIN_FIELD_STEPS = 17;
const MAX_FIELD_STEPS = 257;
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
  let interactionState = 'normal';
  canvas.hidden = false;

  async function plot({
    source,
    context = globalSymbolicContext(),
    clip = null,
    viewport,
    colors,
    colormapPoints = null,
    revision = 0,
    compilation = null
  }) {
    assertAlive();
    if (typeof source !== 'string') throw new TypeError('symbolic source must be a string');
    requireRecord(context, 'symbolic context');

    const normalizedViewport = controllerViewport(viewport);
    const view = buildSymbolicPlotView(normalizedViewport, context);
    const style = buildSymbolicPlotStyle(colors, colormapPoints);
    const transform = symbolicDataToScreenTransform(normalizedViewport, context);
    const localClip = symbolicClipInLocalCoordinates(clip, context);
    const compiled = compilation || kernel.workspaceCompile(workspace, source, context, clip);
    const executionWorkspace = compiled.workspace || workspace;
    if (!compilation) workspace = executionWorkspace;

    const program = compiled.value?.program ?? compiled.value;
    const result = publicProgramResult(program);
    dataToScreenTransform = [...transform];
    renderer.updateTransform(transform);
    renderer.updateClip(localClip);

    if (result.diagnostics.length === 0) {
      const arena = kernel.plot(program, executionWorkspace, view, style, revision);
      snapGeometry = symbolicPlotSnapGeometry(arenaView(arena, kernel.memory));
      renderer.setArena({ memory: kernel.memory, ...arena });
    } else {
      snapGeometry = symbolicPlotSnapGeometry(null);
      renderer.setArena(emptyArena(revision));
    }
    if (visible) renderer.render();

    lastResult = Object.freeze({
      ...result,
      source,
      context,
      clip,
      view,
      style,
      revision
    });
    return lastResult;
  }

  function updateView({ transform, pixelRatio = 1, context = globalSymbolicContext(), clip = null }) {
    assertAlive();
    const cssTransform = symbolicCssPixelTransform(transform, pixelRatio);
    dataToScreenTransform = symbolicDataToScreenTransform({ transform: cssTransform }, context);
    renderer.updateTransform(dataToScreenTransform);
    renderer.updateClip(symbolicClipInLocalCoordinates(clip, context));
    if (visible) renderer.render();
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

  function setInteractionState(state = 'normal') {
    assertAlive();
    if (state === interactionState) return interactionState;
    interactionState = state;
    renderer.updateAppearance({ state });
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
    }
  });
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
  for (const range of arena.ranges || []) {
    if (range.topology === 'point-list') {
      for (let index = 0; index < range.count; index += 1) {
        points.push(vertexAt(arena.data, range.first + index));
      }
    } else if (range.topology === 'line-list') {
      for (let index = 0; index + 1 < range.count; index += 2) {
        segments.push([vertexAt(arena.data, range.first + index), vertexAt(arena.data, range.first + index + 1)]);
      }
    } else if (range.topology === 'line-strip') {
      for (let index = 0; index + 1 < range.count; index += 1) {
        segments.push([vertexAt(arena.data, range.first + index), vertexAt(arena.data, range.first + index + 1)]);
      }
    }
  }
  return Object.freeze({
    points: Object.freeze(points.map(freezePoint)),
    segments: Object.freeze(segments.map(([from, to]) => Object.freeze([freezePoint(from), freezePoint(to)])))
  });
}

export async function createSymbolicCompiler({
  kernel: suppliedKernel = null,
  loadKernel = loadPackagedSymbolicKernel
} = {}) {
  const kernel = suppliedKernel || await loadKernel();
  requireKernel(kernel);
  let workspace = kernel.createWorkspace().handle;

  return Object.freeze({
    compile(source, context = globalSymbolicContext(), clip = null) {
      const result = kernel.compileWithContext(String(source ?? ''), context, clip);
      return publicProgramResult(result.value?.program ?? result.value);
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
  if (!Array.isArray(clip)) throw new TypeError('symbolic clip must be an array');
  const inverse = invertAffine(symbolicContextAffine(context));
  return clip.map((point) => applyAffine(inverse, point));
}

export function buildSymbolicPlotStyle(colors, colormapPoints = null) {
  requireRecord(colors, 'symbolic colors');
  const edge = normalizeColor(colors.edge, 'colors.edge');
  const face = normalizeColor(colors.face, 'colors.face');
  const valueMin = finite(colors.valueMin ?? 0, 'colors.valueMin');
  const valueMax = finite(colors.valueMax ?? 1, 'colors.valueMax');
  if (valueMax <= valueMin) throw new RangeError('symbolic color value range must be increasing');
  return Object.freeze({
    edgeR: edge[0], edgeG: edge[1], edgeB: edge[2], edgeA: edge[3],
    faceR: face[0], faceG: face[1], faceB: face[2], faceA: face[3],
    valueMin,
    valueMax,
    colormapPoints: normalizeColormapPoints(colormapPoints)
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

function publicProgramResult(program) {
  return Object.freeze({
    diagnostics: Object.freeze(Array.isArray(program?.diagnostics) ? [...program.diagnostics] : []),
    latex: typeof program?.latex === 'string' ? program.latex : '',
    variables: Object.freeze(Array.isArray(program?.variables)
      ? program.variables.filter((name) => typeof name === 'string')
      : []),
    classification: typeof program?.classification === 'string' ? program.classification : 'invalid',
    valueKind: typeof program?.valueKind === 'string' ? program.valueKind : 'invalid'
  });
}

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

function vertexAt(data, index) {
  const offset = index * FLOATS_PER_VERTEX;
  return [Number(data[offset]), Number(data[offset + 1])];
}

function freezePoint(point) {
  return Object.freeze([...point]);
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
