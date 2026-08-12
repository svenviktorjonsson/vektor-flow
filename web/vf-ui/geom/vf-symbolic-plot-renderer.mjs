import {
  compileSymbolicComplexFieldShader,
  compileSymbolicScalarFieldShader,
  compileSymbolicRelationShader,
  compileSymbolicRelationShaderGroup
} from './vf-symbolic-relation-shader.mjs';
import { createWebGpuProbeCanvas } from './vf-gpu-backend-probe.mjs';

const FLOATS_PER_VERTEX = 6;
const BYTES_PER_VERTEX = FLOATS_PER_VERTEX * Float32Array.BYTES_PER_ELEMENT;
const DEFAULT_TRANSFORM = Object.freeze([1, 0, 0, 1, 0, 0]);
const FLOATS_PER_SEGMENT = 17;

export const SYMBOLIC_PLOT_EDGE_WIDTH = 2;
export const SYMBOLIC_PLOT_POINT_RADIUS = 6;
export const SYMBOLIC_PLOT_POINT_VERTICES = 6;
export const SYMBOLIC_PLOT_SELECTION_GAP = 4;
export const SYMBOLIC_PLOT_SELECTION_WIDTH = 2;
export const SYMBOLIC_PLOT_SELECTION_COLOR = Object.freeze([120 / 255, 183 / 255, 211 / 255]);
export const SYMBOLIC_PLOT_VERTEX_STRIDE = BYTES_PER_VERTEX;

export function symbolicPlotSelectionHalo(appearance) {
  return Object.freeze({
    width: appearance.edgeWidth
      + 2 * (appearance.selectionGap + appearance.selectionWidth),
    offset: 0,
    innerHalfWidth: appearance.edgeWidth / 2 + appearance.selectionGap
  });
}

export function symbolicPlotPointDraws(arena) {
  return Object.freeze((arena?.ranges || [])
    .filter((range) => range.topology === 'point-list' && range.count > 0)
    .map((range) => Object.freeze({
      first: range.first,
      count: range.count,
      verticesPerInstance: SYMBOLIC_PLOT_POINT_VERTICES
    })));
}

export function normalizeSymbolicPlotAppearance(value = {}) {
  const scalarState = normalizeInteractionState(value.state);
  const requestedParts = value.partStates && typeof value.partStates === 'object'
    ? value.partStates
    : null;
  const partStates = Object.freeze({
    edge: normalizeInteractionState(requestedParts?.edge ?? scalarState),
    face: normalizeInteractionState(requestedParts?.face ?? scalarState)
  });
  const edgeSelectionAlpha = interactionAlpha(partStates.edge);
  const faceSelectionAlpha = interactionAlpha(partStates.face);
  return Object.freeze({
    state: partStates.edge === partStates.face ? partStates.edge : 'mixed',
    partStates,
    edgeWidth: positive(value.edgeWidth, SYMBOLIC_PLOT_EDGE_WIDTH),
    selectionGap: nonNegative(value.selectionGap, SYMBOLIC_PLOT_SELECTION_GAP),
    selectionWidth: positive(value.selectionWidth, SYMBOLIC_PLOT_SELECTION_WIDTH),
    selectionColor: Object.freeze(normalizeRgb(value.selectionColor, SYMBOLIC_PLOT_SELECTION_COLOR)),
    selectionAlpha: Math.max(edgeSelectionAlpha, faceSelectionAlpha),
    edgeSelectionAlpha,
    faceSelectionAlpha
  });
}

function normalizeInteractionState(value) {
  return ['hovered', 'selected'].includes(value) ? value : 'normal';
}

function interactionAlpha(state) {
  return state === 'selected' ? 0.75 : state === 'hovered' ? 0.5 : 0;
}

export function packSymbolicPlotSegments(arena) {
  if (!arena?.data || !(arena.data instanceof Float32Array)) return new Float32Array();
  const packed = [];
  const append = (previous, from, to, next, strokeScale) => {
    const previousOffset = previous * FLOATS_PER_VERTEX;
    const fromOffset = from * FLOATS_PER_VERTEX;
    const toOffset = to * FLOATS_PER_VERTEX;
    const nextOffset = next * FLOATS_PER_VERTEX;
    packed.push(arena.data[previousOffset], arena.data[previousOffset + 1]);
    for (let index = 0; index < FLOATS_PER_VERTEX; index += 1) packed.push(arena.data[fromOffset + index]);
    for (let index = 0; index < FLOATS_PER_VERTEX; index += 1) packed.push(arena.data[toOffset + index]);
    packed.push(arena.data[nextOffset], arena.data[nextOffset + 1], strokeScale);
  };
  for (const range of arena.ranges || []) {
    const strokeScale = Number.isFinite(range.strokeScale)
      ? range.strokeScale
      : range.mode === SymbolicPlotMode.VECTOR_FIELD_GLYPHS ? 0.5 : 1;
    if (range.topology === 'line-list') {
      for (let index = 0; index + 1 < range.count; index += 2) {
        const from = range.first + index;
        const to = from + 1;
        append(from, from, to, to, strokeScale);
      }
    } else if (range.topology === 'line-strip') {
      for (let index = 0; index + 1 < range.count; index += 1) {
        const from = range.first + index;
        const to = from + 1;
        append(
          index > 0 ? from - 1 : from,
          from,
          to,
          index + 2 < range.count ? to + 1 : to,
          strokeScale
        );
      }
    }
  }
  return new Float32Array(packed);
}

function symbolicPlotPrimitiveMetadata(ranges, count) {
  const edges = [];
  const faces = new Array(Math.ceil(count / 3)).fill(null);
  ranges.forEach((range, rangeIndex) => {
    if (range.topology === 'line-list') {
      for (let offset = 0; offset + 1 < range.count; offset += 2) {
        edges.push(Object.freeze({ part: range.part, rangeIndex, primitiveIndex: offset / 2 }));
      }
    } else if (range.topology === 'line-strip') {
      for (let offset = 0; offset + 1 < range.count; offset += 1) {
        edges.push(Object.freeze({ part: range.part, rangeIndex, primitiveIndex: offset }));
      }
    } else if (range.topology === 'triangle-list') {
      for (let offset = 0; offset + 2 < range.count; offset += 3) {
        faces[Math.floor((range.first + offset) / 3)] = Object.freeze({
          part: range.part,
          rangeIndex,
          primitiveIndex: offset / 3
        });
      }
    }
  });
  return Object.freeze({
    edges: Object.freeze(edges),
    faces: Object.freeze(faces),
    facePickCapacity: faces.length
  });
}

export const SymbolicPlotMode = Object.freeze({
  POINTS: 'points',
  LINKED_LINE_SEGMENTS: 'linked-line-segments',
  TRIANGLES: 'triangles',
  SCALAR_FIELD_TRIANGLES: 'scalar-field-triangles',
  VECTOR_FIELD_GLYPHS: 'vector-field-glyphs',
  TIME_CURVE: 'time-curve'
});

const TOPOLOGY_BY_MODE = Object.freeze({
  [SymbolicPlotMode.POINTS]: 'point-list',
  [SymbolicPlotMode.LINKED_LINE_SEGMENTS]: 'line-list',
  [SymbolicPlotMode.TRIANGLES]: 'triangle-list',
  [SymbolicPlotMode.SCALAR_FIELD_TRIANGLES]: 'triangle-list',
  [SymbolicPlotMode.VECTOR_FIELD_GLYPHS]: 'line-list',
  [SymbolicPlotMode.TIME_CURVE]: 'line-strip'
});

export function growSymbolicPlotCapacity(currentBytes, requiredBytes) {
  let capacity = Math.max(0, Number(currentBytes) || 0);
  const required = Math.max(0, Number(requiredBytes) || 0);
  if (required <= capacity) return capacity;
  capacity = Math.max(256, capacity);
  while (capacity < required) capacity *= 2;
  return Math.ceil(capacity / 4) * 4;
}

export function uploadWebGlDynamicBuffer(gl, buffer, data, currentCapacity = 0) {
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  let capacity = currentCapacity;
  if (data.byteLength > capacity) {
    capacity = growSymbolicPlotCapacity(capacity, data.byteLength);
    gl.bufferData(gl.ARRAY_BUFFER, capacity, gl.DYNAMIC_DRAW);
  }
  if (data.byteLength) gl.bufferSubData(gl.ARRAY_BUFFER, 0, data);
  return capacity;
}

export function bindWebGlInstancedAttributes(gl, attributes, stride = FLOATS_PER_SEGMENT * 4) {
  const enabled = [];
  for (const [location, size, offset] of attributes) {
    if (!Number.isInteger(location) || location < 0) continue;
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, size, gl.FLOAT, false, stride, offset);
    gl.vertexAttribDivisor(location, 1);
    enabled.push(location);
  }
  return enabled;
}

export function resolveSymbolicPlotArena(spec, previous = null) {
  if (!spec || typeof spec !== 'object') {
    throw new TypeError('symbolic plot arena must be an object');
  }
  const stride = Number(spec.stride ?? BYTES_PER_VERTEX);
  if (stride !== BYTES_PER_VERTEX) {
    throw new RangeError(`symbolic plot arena stride must be ${BYTES_PER_VERTEX} bytes`);
  }

  let data;
  let sourceBuffer;
  let pointer = 0;
  if (spec.data != null) {
    if (!(spec.data instanceof Float32Array)) {
      throw new TypeError('symbolic plot arena data must be a Float32Array');
    }
    data = spec.data;
    sourceBuffer = data.buffer;
    pointer = data.byteOffset;
  } else {
    const memory = spec.memory;
    if (!(memory instanceof WebAssembly.Memory)) {
      throw new TypeError('symbolic plot arena requires data or WebAssembly.Memory');
    }
    sourceBuffer = memory.buffer;
    pointer = requireNonNegativeInteger(spec.pointer, 'arena pointer');
    if (pointer % Float32Array.BYTES_PER_ELEMENT !== 0) {
      throw new RangeError('symbolic plot arena pointer must be Float32 aligned');
    }
  }

  const availableVertices = spec.data == null
    ? Math.floor((sourceBuffer.byteLength - pointer) / BYTES_PER_VERTEX)
    : Math.floor(data.byteLength / BYTES_PER_VERTEX);
  const count = spec.count == null
    ? availableVertices
    : requireNonNegativeInteger(spec.count, 'arena vertex count');
  if (count > availableVertices) {
    throw new RangeError('symbolic plot arena exceeds its source buffer');
  }

  const floatCount = count * FLOATS_PER_VERTEX;
  if (!data || data.length !== floatCount) {
    const canReuse = previous
      && previous.sourceBuffer === sourceBuffer
      && previous.pointer === pointer
      && previous.count === count;
    data = canReuse
      ? previous.data
      : new Float32Array(sourceBuffer, pointer, floatCount);
  } else if (data.length > floatCount) {
    data = data.subarray(0, floatCount);
  }

  const ranges = normalizeRanges(spec.ranges, count, spec.mode);
  const resolved = {
    data,
    sourceBuffer,
    pointer,
    count,
    stride,
    revision: spec.revision ?? 0,
    ranges
  };
  const segments = packSymbolicPlotSegments(resolved);
  const primitives = symbolicPlotPrimitiveMetadata(ranges, count);
  return Object.freeze({
    ...resolved,
    segments,
    segmentCount: segments.length / FLOATS_PER_SEGMENT,
    primitives
  });
}

export function triangulateSymbolicPlotClip(polygon) {
  const points = normalizePolygon(polygon);
  if (points.length < 3) return new Float32Array();

  const orientation = signedArea(points) >= 0 ? 1 : -1;
  const indices = points.map((_, index) => index);
  const triangles = [];
  let guard = indices.length * indices.length;

  while (indices.length > 3 && guard-- > 0) {
    let clipped = false;
    for (let cursor = 0; cursor < indices.length; cursor += 1) {
      const previous = indices[(cursor - 1 + indices.length) % indices.length];
      const current = indices[cursor];
      const next = indices[(cursor + 1) % indices.length];
      const a = points[previous];
      const b = points[current];
      const c = points[next];
      if (orientation * cross(a, b, c) <= 1e-10) continue;
      if (indices.some((index) => (
        index !== previous
        && index !== current
        && index !== next
        && pointInTriangle(points[index], a, b, c, orientation)
      ))) continue;
      triangles.push(...a, ...b, ...c);
      indices.splice(cursor, 1);
      clipped = true;
      break;
    }
    if (!clipped) {
      throw new RangeError('clip polygon must be simple and non-self-intersecting');
    }
  }

  if (indices.length === 3) {
    triangles.push(
      ...points[indices[0]],
      ...points[indices[1]],
      ...points[indices[2]]
    );
  }
  return new Float32Array(triangles);
}

export function triangulateSymbolicPlotClipRegion(clip) {
  if (clip == null) return emptySymbolicPlotClipGeometry();
  const region = normalizeClipRegion(clip);
  const outer = triangulateSymbolicPlotClip(region.outer);
  const holes = region.holes.map((polygon) => triangulateSymbolicPlotClip(polygon));
  const vertices = new Float32Array(
    outer.length + holes.reduce((length, triangles) => length + triangles.length, 0)
  );
  vertices.set(outer);
  let first = outer.length / 2;
  const holeRanges = holes.map((triangles) => {
    vertices.set(triangles, first * 2);
    const range = Object.freeze({ first, count: triangles.length / 2 });
    first += range.count;
    return range;
  });
  return Object.freeze({
    vertices,
    outerCount: outer.length / 2,
    holeRanges: Object.freeze(holeRanges)
  });
}

export function symbolicPlotClipStencilDraws(geometry) {
  if (!geometry?.outerCount) return Object.freeze([]);
  return Object.freeze([
    Object.freeze({ first: 0, count: geometry.outerCount, reference: 1 }),
    ...geometry.holeRanges
      .filter(({ count }) => count > 0)
      .map(({ first, count }) => Object.freeze({ first, count, reference: 0 }))
  ]);
}

function emptySymbolicPlotClipGeometry() {
  return Object.freeze({
    vertices: new Float32Array(),
    outerCount: 0,
    holeRanges: Object.freeze([])
  });
}

export function createSymbolicPlotRenderer(canvas, options = {}) {
  if (!canvas?.getContext) throw new TypeError('canvas must provide getContext');
  const pixelRatio = options.pixelRatio || (() => globalThis.devicePixelRatio || 1);
  const backendFactory = options.backendFactory || createDefaultBackend;
  let backend = null;
  let arena = null;
  let transform = [...DEFAULT_TRANSFORM];
  let clipGeometry = emptySymbolicPlotClipGeometry();
  let cssWidth = 1;
  let cssHeight = 1;
  let uploadedData = null;
  let uploadedRevision = Symbol('not-uploaded');
  let appearance = normalizeSymbolicPlotAppearance();
  let relation = null;
  let destroyed = false;

  async function initialize() {
    assertAlive();
    resize();
    backend = await backendFactory(canvas, options);
    if (!backend) throw new Error('A WebGPU or WebGL2 GPU backend is required');
    backend.resize(cssWidth, cssHeight);
    backend.updateTransform(transform);
    backend.updateClip(clipGeometry);
    backend.updateAppearance(appearance);
    backend.updateRelation?.(relation);
    return backend.kind;
  }

  function setArena(nextArena) {
    assertAlive();
    arena = resolveSymbolicPlotArena(nextArena, arena);
    return arena;
  }

  function updateAppearance(nextAppearance = {}) {
    assertAlive();
    appearance = normalizeSymbolicPlotAppearance(nextAppearance);
    backend?.updateAppearance(appearance);
    return appearance;
  }

  function setAnalyticRelation(nextRelation = null) {
    return setAnalyticRelations(nextRelation == null ? null : [nextRelation]);
  }

  function setAnalyticRelations(nextRelations = null) {
    assertAlive();
    if (nextRelations == null || nextRelations.length === 0) {
      relation = null;
    } else {
      const shader = nextRelations.length === 1
        ? compileSymbolicRelationShader(nextRelations[0].ast, nextRelations[0].variants)
        : compileSymbolicRelationShaderGroup(nextRelations);
      relation = shader ? Object.freeze({
        shader,
        style: Object.freeze({ ...nextRelations[0].style }),
        t: Number(nextRelations[0].t) || 0
      }) : null;
    }
    backend?.updateRelation?.(relation);
    return relation;
  }

  function setAnalyticScalarField(nextField = null) {
    assertAlive();
    const shader = nextField
      ? compileSymbolicScalarFieldShader(nextField.ast, nextField.style)
      : null;
    relation = shader ? Object.freeze({
      shader,
      style: Object.freeze({ ...nextField.style }),
      t: Number(nextField.t) || 0
    }) : null;
    backend?.updateRelation?.(relation);
    return relation;
  }

  function setAnalyticComplexField(nextField = null) {
    assertAlive();
    const shader = nextField
      ? compileSymbolicComplexFieldShader(nextField.ast, nextField.style)
      : null;
    relation = shader ? Object.freeze({
      shader,
      style: Object.freeze({ ...nextField.style }),
      t: Number(nextField.t) || 0
    }) : null;
    backend?.updateRelation?.(relation);
    return relation;
  }

  function updateTransform(nextTransform) {
    assertAlive();
    transform = normalizeTransform(nextTransform);
    backend?.updateTransform(transform);
  }

  function updateClip(clip = null) {
    assertAlive();
    clipGeometry = triangulateSymbolicPlotClipRegion(clip);
    backend?.updateClip(clipGeometry);
  }

  function resize(width = canvas.clientWidth, height = canvas.clientHeight) {
    assertAlive();
    cssWidth = Math.max(1, Number(width) || 1);
    cssHeight = Math.max(1, Number(height) || 1);
    const ratio = Math.max(1, Number(pixelRatio()) || 1);
    const bufferWidth = Math.max(1, Math.round(cssWidth * ratio));
    const bufferHeight = Math.max(1, Math.round(cssHeight * ratio));
    if (canvas.width !== bufferWidth) canvas.width = bufferWidth;
    if (canvas.height !== bufferHeight) canvas.height = bufferHeight;
    backend?.resize(cssWidth, cssHeight);
    backend?.updateTransform(transform);
  }

  function render() {
    assertAlive();
    if (!backend) throw new Error('symbolic plot renderer is not initialized');
    if (!arena && !relation) {
      backend.render(null, false);
      return;
    }
    const upload = uploadedData !== arena.data || uploadedRevision !== arena.revision;
    backend.render(arena, upload);
    if (upload) {
      uploadedData = arena.data;
      uploadedRevision = arena.revision;
    }
  }

  async function pick(screenPoint, radius = 7) {
    assertAlive();
    if (!backend) throw new Error('symbolic plot renderer is not initialized');
    const request = normalizeSymbolicPlotPickRequest(screenPoint, radius, cssWidth, cssHeight);
    if (!request || (!arena && !relation) || typeof backend.pick !== 'function') return null;
    const hit = await backend.pick(request);
    if (!hit) return null;
    if (hit.kind === 'relation-edge' || hit.kind === 'relation-face') {
      return Object.freeze({
        kind: hit.kind === 'relation-edge' ? 'segment' : 'triangle',
        index: 0,
        part: hit.kind === 'relation-edge' ? 'edge' : 'face',
        rangeIndex: 0,
        primitiveIndex: 0,
        analytic: true
      });
    }
    const metadata = hit.kind === 'triangle'
      ? arena.primitives.faces[hit.index]
      : arena.primitives.edges[hit.index];
    return metadata ? Object.freeze({ ...hit, ...metadata }) : null;
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    backend?.destroy();
    backend = null;
    arena = null;
    uploadedData = null;
    clipGeometry = emptySymbolicPlotClipGeometry();
  }

  function assertAlive() {
    if (destroyed) throw new Error('symbolic plot renderer is destroyed');
  }

  return Object.freeze({
    initialize,
    setArena,
    updateTransform,
    updateClip,
    updateAppearance,
    setAnalyticRelation,
    setAnalyticRelations,
    setAnalyticScalarField,
    setAnalyticComplexField,
    resize,
    render,
    pick,
    destroy,
    get backend() {
      return backend?.kind || null;
    }
  });
}

export function normalizeSymbolicPlotPickRequest(screenPoint, radius, width, height) {
  if ((!Array.isArray(screenPoint) && !ArrayBuffer.isView(screenPoint)) || screenPoint.length < 2) {
    throw new TypeError('symbolic plot pick point must contain x and y');
  }
  const x = Number(screenPoint[0]);
  const y = Number(screenPoint[1]);
  const hitRadius = Number(radius);
  if (![x, y, hitRadius].every(Number.isFinite)) {
    throw new TypeError('symbolic plot pick values must be finite');
  }
  if (hitRadius < 0) throw new RangeError('symbolic plot pick radius must be non-negative');
  const viewportWidth = Math.max(1, Number(width) || 1);
  const viewportHeight = Math.max(1, Number(height) || 1);
  if (x < 0 || y < 0 || x >= viewportWidth || y >= viewportHeight) return null;
  return Object.freeze({ x, y, radius: hitRadius, width: viewportWidth, height: viewportHeight });
}

function positive(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function relationShaderKey(shader) {
  return shader ? JSON.stringify(shader) : null;
}

function nonNegative(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function normalizeRgb(value, fallback) {
  if (!Array.isArray(value) && !ArrayBuffer.isView(value)) return [...fallback];
  return [0, 1, 2].map((index) => Math.max(0, Math.min(1, Number(value[index]) || 0)));
}

function normalizeRanges(ranges, count, defaultMode) {
  const input = ranges == null
    ? [{ mode: defaultMode || SymbolicPlotMode.TRIANGLES, first: 0, count }]
    : ranges;
  if (!Array.isArray(input)) throw new TypeError('arena ranges must be an array');
  return Object.freeze(input.map((range) => {
    const mode = String(range?.mode || '');
    const topology = TOPOLOGY_BY_MODE[mode];
    if (!topology) throw new RangeError(`unsupported symbolic plot mode: ${mode}`);
    const first = requireNonNegativeInteger(range.first ?? 0, 'range first');
    const rangeCount = requireNonNegativeInteger(range.count ?? 0, 'range count');
    if (first + rangeCount > count) throw new RangeError('plot range exceeds arena');
    if (topology === 'line-list' && rangeCount % 2 !== 0) {
      throw new RangeError(`${mode} requires pairs of vertices`);
    }
    if (topology === 'triangle-list' && rangeCount % 3 !== 0) {
      throw new RangeError(`${mode} requires complete triangles`);
    }
    const defaultPart = topology === 'triangle-list' ? 'face' : 'edge';
    const part = range?.part == null ? defaultPart : String(range.part);
    if (!['face', 'edge'].includes(part)) throw new RangeError(`unsupported symbolic plot part: ${part}`);
    const strokeScale = mode === SymbolicPlotMode.VECTOR_FIELD_GLYPHS ? 0.5 : 1;
    return Object.freeze({ mode, part, topology, first, count: rangeCount, strokeScale });
  }));
}

function normalizeTransform(value) {
  if ((!Array.isArray(value) && !ArrayBuffer.isView(value)) || value.length !== 6) {
    throw new TypeError('data-to-screen transform must contain six affine values');
  }
  const result = Array.from(value, Number);
  if (!result.every(Number.isFinite)) {
    throw new TypeError('data-to-screen transform values must be finite');
  }
  return result;
}

function normalizeClipRegion(value) {
  if (Array.isArray(value)) return { outer: value, holes: [] };
  if (!value || typeof value !== 'object') {
    throw new TypeError('clip must be a polygon or region');
  }
  if (!Array.isArray(value.outer)) throw new TypeError('clip region outer must be a polygon');
  const holes = value.holes ?? [];
  if (!Array.isArray(holes)) throw new TypeError('clip region holes must be an array');
  return { outer: value.outer, holes };
}

function normalizePolygon(value) {
  if (!Array.isArray(value)) throw new TypeError('clip polygon must be an array');
  const result = [];
  for (const point of value) {
    if ((!Array.isArray(point) && !ArrayBuffer.isView(point)) || point.length < 2) {
      throw new TypeError('clip polygon points must contain x and y');
    }
    const x = Number(point[0]);
    const y = Number(point[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new TypeError('clip polygon coordinates must be finite');
    }
    const previous = result[result.length - 1];
    if (!previous || previous[0] !== x || previous[1] !== y) result.push([x, y]);
  }
  if (
    result.length > 1
    && result[0][0] === result[result.length - 1][0]
    && result[0][1] === result[result.length - 1][1]
  ) result.pop();
  return result;
}

function requireNonNegativeInteger(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new RangeError(`${label} must be a non-negative integer`);
  }
  return number;
}

function signedArea(points) {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    const next = points[(index + 1) % points.length];
    area += point[0] * next[1] - next[0] * point[1];
  }
  return area / 2;
}

function cross(a, b, c) {
  return (b[0] - a[0]) * (c[1] - a[1])
    - (b[1] - a[1]) * (c[0] - a[0]);
}

function pointInTriangle(point, a, b, c, orientation) {
  return orientation * cross(a, b, point) >= -1e-10
    && orientation * cross(b, c, point) >= -1e-10
    && orientation * cross(c, a, point) >= -1e-10;
}

async function createDefaultBackend(canvas) {
  const webGpu = await createWebGpuBackend(canvas).catch(() => null);
  return webGpu || createWebGl2Backend(canvas);
}

async function createWebGpuBackend(canvas) {
  if (!globalThis.navigator?.gpu) return null;
  const probeCanvas = createWebGpuProbeCanvas(canvas);
  if (!probeCanvas?.getContext?.('webgpu')) return null;
  const adapter = await globalThis.navigator.gpu.requestAdapter();
  if (!adapter) return null;
  const device = await adapter.requestDevice();
  const context = canvas.getContext('webgpu');
  if (!context) return null;
  const format = globalThis.navigator.gpu.getPreferredCanvasFormat();
  const shader = device.createShaderModule({ code: webGpuShaderSource() });
  const selectionCompositeShader = device.createShaderModule({ code: webGpuSelectionCompositeShaderSource() });
  const transformBuffer = device.createBuffer({
    size: 48,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
  });
  const strokeBuffers = Array.from({ length: 4 }, () => device.createBuffer({
    size: 32,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
  }));
  const bindGroupLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } }
    ]
  });
  const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] });
  const bindGroups = strokeBuffers.map((buffer) => device.createBindGroup({
    layout: bindGroupLayout,
    entries: [
      { binding: 0, resource: { buffer: transformBuffer } },
      { binding: 1, resource: { buffer } }
    ]
  }));
  const vertexLayout = {
    arrayStride: BYTES_PER_VERTEX,
    attributes: [
      { shaderLocation: 0, offset: 0, format: 'float32x2' },
      { shaderLocation: 1, offset: 8, format: 'float32x4' }
    ]
  };
  const pointVertexLayout = { ...vertexLayout, stepMode: 'instance' };
  const clipVertexLayout = {
    arrayStride: 8,
    attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }]
  };
  const segmentVertexLayout = {
    arrayStride: FLOATS_PER_SEGMENT * Float32Array.BYTES_PER_ELEMENT,
    stepMode: 'instance',
    attributes: [
      { shaderLocation: 2, offset: 0, format: 'float32x2' },
      { shaderLocation: 3, offset: 8, format: 'float32x2' },
      { shaderLocation: 4, offset: 16, format: 'float32x4' },
      { shaderLocation: 5, offset: 32, format: 'float32x2' },
      { shaderLocation: 6, offset: 40, format: 'float32x4' },
      { shaderLocation: 7, offset: 56, format: 'float32x2' },
      { shaderLocation: 8, offset: 64, format: 'float32' }
    ]
  };
  const depthStencil = (compare, passOp = 'keep') => ({
    format: 'depth24plus-stencil8',
    depthWriteEnabled: false,
    depthCompare: 'always',
    stencilFront: { compare, passOp },
    stencilBack: { compare, passOp },
    stencilReadMask: 0xff,
    stencilWriteMask: 0xff
  });
  const pipelines = new Map();
  for (const topology of new Set(Object.values(TOPOLOGY_BY_MODE))) {
    for (const clipped of [false, true]) {
      pipelines.set(`${topology}:${clipped}`, device.createRenderPipeline({
        layout: pipelineLayout,
        vertex: { module: shader, entryPoint: 'plotVertex', buffers: [vertexLayout] },
        fragment: {
          module: shader,
          entryPoint: 'plotFragment',
          targets: [{
            format,
            blend: {
              color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' },
              alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' }
            }
          }]
        },
        primitive: { topology },
        depthStencil: depthStencil(clipped ? 'equal' : 'always')
      }));
    }
  }
  const pointPipelines = new Map([false, true].map((clipped) => [clipped, device.createRenderPipeline({
    layout: pipelineLayout,
    vertex: { module: shader, entryPoint: 'pointVertex', buffers: [pointVertexLayout] },
    fragment: {
      module: shader,
      entryPoint: 'pointFragment',
      targets: [{
        format,
        blend: {
          color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' },
          alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' }
        }
      }]
    },
    primitive: { topology: 'triangle-list' },
    depthStencil: depthStencil(clipped ? 'equal' : 'always')
  })]));
  const clipPipeline = device.createRenderPipeline({
    layout: pipelineLayout,
    vertex: { module: shader, entryPoint: 'clipVertex', buffers: [clipVertexLayout] },
    fragment: {
      module: shader,
      entryPoint: 'clipFragment',
      targets: [{ format, writeMask: 0 }]
    },
    primitive: { topology: 'triangle-list' },
    depthStencil: depthStencil('always', 'replace')
  });
  const strokePipelines = new Map([false, true].map((clipped) => [clipped, device.createRenderPipeline({
    layout: pipelineLayout,
    vertex: { module: shader, entryPoint: 'strokeVertex', buffers: [segmentVertexLayout] },
    fragment: {
      module: shader,
      entryPoint: 'strokeFragment',
      targets: [{
        format,
        blend: {
          color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' },
          alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' }
        }
      }]
    },
    primitive: { topology: 'triangle-list' },
    depthStencil: depthStencil(clipped ? 'equal' : 'always')
  })]));
  const selectionMaskPipeline = device.createRenderPipeline({
    layout: pipelineLayout,
    vertex: { module: shader, entryPoint: 'strokeVertex', buffers: [segmentVertexLayout] },
    fragment: {
      module: shader,
      entryPoint: 'selectionMaskFragment',
      targets: [{
        format: 'rgba8unorm',
        blend: {
          color: { operation: 'max', srcFactor: 'one', dstFactor: 'one' },
          alpha: { operation: 'max', srcFactor: 'one', dstFactor: 'one' }
        }
      }]
    },
    primitive: { topology: 'triangle-list' }
  });
  const selectionCompositeBuffer = device.createBuffer({
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
  });
  const selectionCompositeLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }
    ]
  });
  const selectionCompositePipelineLayout = device.createPipelineLayout({
    bindGroupLayouts: [selectionCompositeLayout]
  });
  const selectionCompositePipelines = new Map([false, true].map((clipped) => [clipped, device.createRenderPipeline({
    layout: selectionCompositePipelineLayout,
    vertex: { module: selectionCompositeShader, entryPoint: 'selectionCompositeVertex' },
    fragment: {
      module: selectionCompositeShader,
      entryPoint: 'selectionCompositeFragment',
      targets: [{
        format,
        blend: {
          color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' },
          alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' }
        }
      }]
    },
    primitive: { topology: 'triangle-list' },
    depthStencil: depthStencil(clipped ? 'equal' : 'always')
  })]));
  const faceSelectionPipelines = new Map([false, true].map((clipped) => [clipped, device.createRenderPipeline({
    layout: pipelineLayout,
    vertex: { module: shader, entryPoint: 'selectionFaceVertex', buffers: [vertexLayout] },
    fragment: {
      module: shader,
      entryPoint: 'plotFragment',
      targets: [{
        format,
        blend: {
          color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' },
          alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' }
        }
      }]
    },
    primitive: { topology: 'triangle-list' },
    depthStencil: depthStencil(clipped ? 'equal' : 'always')
  })]));
  const pickStrokeBuffer = device.createBuffer({
    size: 32,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
  });
  const pickBindGroup = device.createBindGroup({
    layout: bindGroupLayout,
    entries: [
      { binding: 0, resource: { buffer: transformBuffer } },
      { binding: 1, resource: { buffer: pickStrokeBuffer } }
    ]
  });
  const pickPipelines = new Map([false, true].map((clipped) => [clipped, device.createRenderPipeline({
    layout: pipelineLayout,
    vertex: { module: shader, entryPoint: 'pickStrokeVertex', buffers: [segmentVertexLayout] },
    fragment: { module: shader, entryPoint: 'pickFragment', targets: [{ format: 'r32uint' }] },
    primitive: { topology: 'triangle-list' },
    depthStencil: depthStencil(clipped ? 'equal' : 'always')
  })]));
  const facePickPipelines = new Map([false, true].map((clipped) => [clipped, device.createRenderPipeline({
    layout: pipelineLayout,
    vertex: { module: shader, entryPoint: 'pickFaceVertex', buffers: [vertexLayout] },
    fragment: { module: shader, entryPoint: 'pickFragment', targets: [{ format: 'r32uint' }] },
    primitive: { topology: 'triangle-list' },
    depthStencil: depthStencil(clipped ? 'equal' : 'always')
  })]));
  const pickClipPipeline = device.createRenderPipeline({
    layout: pipelineLayout,
    vertex: { module: shader, entryPoint: 'clipVertex', buffers: [clipVertexLayout] },
    fragment: { module: shader, entryPoint: 'pickClipFragment', targets: [{ format: 'r32uint', writeMask: 0 }] },
    primitive: { topology: 'triangle-list' },
    depthStencil: depthStencil('always', 'replace')
  });

  let plotBuffer = null;
  let plotCapacity = 0;
  let segmentBuffer = null;
  let segmentCapacity = 0;
  let clipBuffer = null;
  let clipCapacity = 0;
  let clipDraws = Object.freeze([]);
  let currentArena = null;
  let stencilTexture = null;
  let pickTexture = null;
  let selectionMaskTexture = null;
  let selectionCompositeBindGroup = null;
  let cssSize = [1, 1];
  let appearance = normalizeSymbolicPlotAppearance();
  let currentTransform = [...DEFAULT_TRANSFORM];
  let relation = null;
  let relationBuffer = null;
  let relationBindGroup = null;
  let relationPipelines = null;
  let relationPickPipelines = null;

  function writeRelationUniforms() {
    if (!relation || !relationBuffer) return;
    const [a, b, c, d, e, f] = currentTransform;
    const style = relation.style;
    const ratio = Math.max(1, canvas.width / Math.max(1, cssSize[0]));
    device.queue.writeBuffer(relationBuffer, 0, new Float32Array([
      a, c, e, 0, b, d, f, 0, cssSize[0], cssSize[1], 0, 0,
      style.faceR, style.faceG, style.faceB, style.faceA,
      style.edgeR, style.edgeG, style.edgeB, style.edgeA,
      ...appearance.selectionColor, 1,
      appearance.edgeWidth * ratio, appearance.selectionGap * ratio,
      appearance.selectionWidth * ratio, ratio,
      appearance.edgeSelectionAlpha, appearance.faceSelectionAlpha, relation.t, 0
    ]));
  }

  function configureRelation(nextRelation) {
    const nextKey = relationShaderKey(nextRelation?.shader);
    const currentKey = relationShaderKey(relation?.shader);
    relation = nextRelation;
    if (nextKey === currentKey) {
      writeRelationUniforms();
      return;
    }
    relationBuffer?.destroy();
    relationBuffer = null;
    relationBindGroup = null;
    relationPipelines = null;
    relationPickPipelines = null;
    if (!nextRelation) return;
    relationBuffer = device.createBuffer({ size: 128, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const layout = device.createBindGroupLayout({
      entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }]
    });
    const module = device.createShaderModule({ code: webGpuRelationShaderSource(nextRelation.shader) });
    relationBindGroup = device.createBindGroup({
      layout,
      entries: [{ binding: 0, resource: { buffer: relationBuffer } }]
    });
    const relationPipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] });
    relationPipelines = new Map([false, true].map((clipped) => [clipped, device.createRenderPipeline({
      layout: relationPipelineLayout,
      vertex: { module, entryPoint: 'relationVertex' },
      fragment: {
        module,
        entryPoint: 'relationFragment',
        targets: [{
          format,
          blend: {
            color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' },
            alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' }
          }
        }]
      },
      primitive: { topology: 'triangle-list' },
      depthStencil: depthStencil(clipped ? 'equal' : 'always')
    })]));
    relationPickPipelines = new Map([false, true].map((clipped) => [clipped, device.createRenderPipeline({
      layout: relationPipelineLayout,
      vertex: { module, entryPoint: 'relationVertex' },
      fragment: { module, entryPoint: 'relationPickFragment', targets: [{ format: 'r32uint' }] },
      primitive: { topology: 'triangle-list' },
      depthStencil: depthStencil(clipped ? 'equal' : 'always')
    })]));
    writeRelationUniforms();
  }

  function ensureBuffer(buffer, capacity, required, usage) {
    if (required <= capacity) return [buffer, capacity];
    buffer?.destroy();
    const nextCapacity = growSymbolicPlotCapacity(capacity, required);
    return [device.createBuffer({ size: nextCapacity, usage }), nextCapacity];
  }

  return {
    kind: 'webgpu',
    resize(width, height) {
      cssSize = [width, height];
      context.configure({ device, format, alphaMode: 'premultiplied' });
      stencilTexture?.destroy();
      pickTexture?.destroy();
      selectionMaskTexture?.destroy();
      stencilTexture = device.createTexture({
        size: [canvas.width, canvas.height],
        format: 'depth24plus-stencil8',
        usage: GPUTextureUsage.RENDER_ATTACHMENT
      });
      pickTexture = device.createTexture({
        size: [canvas.width, canvas.height],
        format: 'r32uint',
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC
      });
      selectionMaskTexture = device.createTexture({
        size: [canvas.width, canvas.height],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
      });
      selectionCompositeBindGroup = device.createBindGroup({
        layout: selectionCompositeLayout,
        entries: [
          { binding: 0, resource: selectionMaskTexture.createView() },
          { binding: 1, resource: { buffer: selectionCompositeBuffer } }
        ]
      });
      writeRelationUniforms();
    },
    updateTransform(transform) {
      currentTransform = [...transform];
      writeWebGpuTransform(device, transformBuffer, transform, cssSize);
      writeRelationUniforms();
    },
    updateClip(geometry) {
      clipDraws = symbolicPlotClipStencilDraws(geometry);
      const { vertices } = geometry;
      [clipBuffer, clipCapacity] = ensureBuffer(
        clipBuffer,
        clipCapacity,
        vertices.byteLength,
        GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
      );
      if (vertices.byteLength) device.queue.writeBuffer(clipBuffer, 0, vertices);
    },
    updateAppearance(nextAppearance) {
      appearance = nextAppearance;
      writeWebGpuStrokePasses(device, strokeBuffers, appearance);
      device.queue.writeBuffer(selectionCompositeBuffer, 0, new Float32Array([
        ...appearance.selectionColor, appearance.edgeSelectionAlpha
      ]));
      writeRelationUniforms();
    },
    updateRelation(nextRelation) {
      configureRelation(nextRelation);
    },
    render(arena, upload) {
      currentArena = arena;
      if (currentArena && upload) {
        [plotBuffer, plotCapacity] = ensureBuffer(
          plotBuffer,
          plotCapacity,
          currentArena.data.byteLength,
          GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
        );
        if (currentArena.data.byteLength) {
          device.queue.writeBuffer(plotBuffer, 0, currentArena.data);
        }
        [segmentBuffer, segmentCapacity] = ensureBuffer(
          segmentBuffer,
          segmentCapacity,
          currentArena.segments.byteLength,
          GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
        );
        if (currentArena.segments.byteLength) device.queue.writeBuffer(segmentBuffer, 0, currentArena.segments);
      }
      const encoder = device.createCommandEncoder();
      if (
        appearance.edgeSelectionAlpha > 0
        && selectionMaskTexture
        && segmentBuffer
        && currentArena?.segmentCount
      ) {
        const selectionPass = encoder.beginRenderPass({
          colorAttachments: [{
            view: selectionMaskTexture.createView(),
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
            loadOp: 'clear',
            storeOp: 'store'
          }]
        });
        selectionPass.setPipeline(selectionMaskPipeline);
        selectionPass.setBindGroup(0, bindGroups[1]);
        selectionPass.setVertexBuffer(0, segmentBuffer);
        selectionPass.draw(6, currentArena.segmentCount);
        selectionPass.end();
      }
      const pass = encoder.beginRenderPass({
        colorAttachments: [{
          view: context.getCurrentTexture().createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: 'clear',
          storeOp: 'store'
        }],
        depthStencilAttachment: {
          view: stencilTexture.createView(),
          depthClearValue: 1,
          depthLoadOp: 'clear',
          depthStoreOp: 'discard',
          stencilClearValue: 0,
          stencilLoadOp: 'clear',
          stencilStoreOp: 'discard'
        }
      });
      const clipped = clipDraws.length > 0;
      if (clipped) {
        pass.setPipeline(clipPipeline);
        pass.setBindGroup(0, bindGroups[0]);
        pass.setVertexBuffer(0, clipBuffer);
        for (const draw of clipDraws) {
          pass.setStencilReference(draw.reference);
          pass.draw(draw.count, 1, draw.first);
        }
      }
      if (relation && relationPipelines && relationBindGroup) {
        pass.setPipeline(relationPipelines.get(clipped));
        pass.setBindGroup(0, relationBindGroup);
        pass.setStencilReference(1);
        pass.draw(3);
        pass.end();
        device.queue.submit([encoder.finish()]);
        return;
      }
      if (plotBuffer && currentArena) {
        pass.setBindGroup(0, bindGroups[0]);
        pass.setStencilReference(1);
        pass.setVertexBuffer(0, plotBuffer);
        for (const range of currentArena.ranges) {
          if (!range.count) continue;
          if (['point-list', 'line-list', 'line-strip'].includes(range.topology)) continue;
          pass.setPipeline(pipelines.get(`${range.topology}:${clipped}`));
          pass.draw(range.count, 1, range.first);
        }
        pass.setPipeline(pointPipelines.get(clipped));
        for (const draw of symbolicPlotPointDraws(currentArena)) {
          pass.draw(draw.verticesPerInstance, draw.count, 0, draw.first);
        }
        if (appearance.faceSelectionAlpha > 0) {
          pass.setPipeline(faceSelectionPipelines.get(clipped));
          pass.setBindGroup(0, bindGroups[3]);
          for (const range of currentArena.ranges) {
            if (range.part === 'face' && range.topology === 'triangle-list' && range.count) {
              pass.draw(range.count, 1, range.first);
            }
          }
        }
      }
      if (
        appearance.edgeSelectionAlpha > 0
        && selectionCompositeBindGroup
        && currentArena?.segmentCount
      ) {
        pass.setPipeline(selectionCompositePipelines.get(clipped));
        pass.setBindGroup(0, selectionCompositeBindGroup);
        pass.setStencilReference(1);
        pass.draw(3);
      }
      if (segmentBuffer && currentArena?.segmentCount) {
        pass.setPipeline(strokePipelines.get(clipped));
        pass.setStencilReference(1);
        pass.setVertexBuffer(0, segmentBuffer);
        pass.setBindGroup(0, bindGroups[0]);
        pass.draw(6, currentArena.segmentCount);
      }
      pass.end();
      device.queue.submit([encoder.finish()]);
    },
    async pick(request) {
      if (!pickTexture || (!relation && (!currentArena || (!currentArena.segmentCount && !currentArena.primitives.facePickCapacity)))) return null;
      const scaleX = canvas.width / cssSize[0];
      const scaleY = canvas.height / cssSize[1];
      const pixelX = Math.min(canvas.width - 1, Math.floor(request.x * scaleX));
      const pixelY = Math.min(canvas.height - 1, Math.floor(request.y * scaleY));
      const pickUniform = new ArrayBuffer(32);
      new Float32Array(pickUniform)[0] = appearance.edgeWidth + request.radius * 2;
      new Uint32Array(pickUniform)[3] = currentArena?.primitives.facePickCapacity || 0;
      device.queue.writeBuffer(pickStrokeBuffer, 0, pickUniform);
      if (relationBuffer && relation) {
        device.queue.writeBuffer(relationBuffer, 27 * Float32Array.BYTES_PER_ELEMENT, new Float32Array([
          request.radius * Math.max(1, canvas.width / Math.max(1, cssSize[0]))
        ]));
      }
      const readback = device.createBuffer({
        size: 256,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
      });
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginRenderPass({
        colorAttachments: [{
          view: pickTexture.createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: 'clear',
          storeOp: 'store'
        }],
        depthStencilAttachment: {
          view: stencilTexture.createView(),
          depthClearValue: 1,
          depthLoadOp: 'clear',
          depthStoreOp: 'discard',
          stencilClearValue: 0,
          stencilLoadOp: 'clear',
          stencilStoreOp: 'discard'
        }
      });
      pass.setScissorRect(pixelX, pixelY, 1, 1);
      const clipped = clipDraws.length > 0;
      if (clipped) {
        pass.setPipeline(pickClipPipeline);
        pass.setBindGroup(0, pickBindGroup);
        pass.setVertexBuffer(0, clipBuffer);
        for (const draw of clipDraws) {
          pass.setStencilReference(draw.reference);
          pass.draw(draw.count, 1, draw.first);
        }
      }
      pass.setStencilReference(1);
      if (relation && relationPickPipelines && relationBindGroup) {
        pass.setPipeline(relationPickPipelines.get(clipped));
        pass.setBindGroup(0, relationBindGroup);
        pass.draw(3);
      } else if (plotBuffer && currentArena.primitives.facePickCapacity) {
        pass.setBindGroup(0, pickBindGroup);
        pass.setPipeline(facePickPipelines.get(clipped));
        pass.setVertexBuffer(0, plotBuffer);
        for (const range of currentArena.ranges) {
          if (range.part === 'face' && range.topology === 'triangle-list' && range.count) {
            pass.draw(range.count, 1, range.first);
          }
        }
      }
      if (!relation && segmentBuffer && currentArena?.segmentCount) {
        pass.setBindGroup(0, pickBindGroup);
        pass.setPipeline(pickPipelines.get(clipped));
        pass.setVertexBuffer(0, segmentBuffer);
        pass.draw(6, currentArena.segmentCount);
      }
      pass.end();
      encoder.copyTextureToBuffer(
        { texture: pickTexture, origin: { x: pixelX, y: pixelY } },
        { buffer: readback, bytesPerRow: 256 },
        { width: 1, height: 1 }
      );
      device.queue.submit([encoder.finish()]);
      await readback.mapAsync(GPUMapMode.READ);
      const value = new Uint32Array(readback.getMappedRange())[0];
      readback.unmap();
      readback.destroy();
      writeRelationUniforms();
      if (!value) return null;
      if (relation) return Object.freeze({ kind: value === 2 ? 'relation-edge' : 'relation-face', index: 0 });
      return value <= currentArena.primitives.facePickCapacity
        ? Object.freeze({ kind: 'triangle', index: value - 1 })
        : Object.freeze({ kind: 'segment', index: value - currentArena.primitives.facePickCapacity - 1 });
    },
    destroy() {
      plotBuffer?.destroy();
      clipBuffer?.destroy();
      segmentBuffer?.destroy();
      stencilTexture?.destroy();
      pickTexture?.destroy();
      selectionMaskTexture?.destroy();
      transformBuffer.destroy();
      strokeBuffers.forEach((buffer) => buffer.destroy());
      pickStrokeBuffer.destroy();
      selectionCompositeBuffer.destroy();
      relationBuffer?.destroy();
      device.destroy();
    }
  };
}

function writeWebGpuTransform(device, buffer, transform, size) {
  const [a, b, c, d, e, f] = transform;
  device.queue.writeBuffer(buffer, 0, new Float32Array([
    a, c, e, 0,
    b, d, f, 0,
    size[0], size[1], 0, 0
  ]));
}

function writeWebGpuStrokePasses(device, buffers, appearance) {
  const halo = symbolicPlotSelectionHalo(appearance);
  const write = (buffer, width, strokeOffset, color, alpha, override, innerHalfWidth = 0) => {
    device.queue.writeBuffer(buffer, 0, new Float32Array([
      width, strokeOffset, override ? 1 : 0, innerHalfWidth,
      color[0], color[1], color[2], alpha
    ]));
  };
  write(buffers[0], appearance.edgeWidth, 0, [0, 0, 0], 0, false);
  write(
    buffers[1], halo.width, halo.offset, appearance.selectionColor,
    appearance.edgeSelectionAlpha, true, halo.innerHalfWidth
  );
  write(buffers[2], 0, 0, appearance.selectionColor, 0, true);
  write(buffers[3], 0, 0, appearance.selectionColor, appearance.faceSelectionAlpha, true);
}

export function webGpuRelationShaderSource(shader) {
  if (shader.kind === 'complex-field') return webGpuComplexFieldShaderSource(shader);
  if (shader.kind === 'scalar-field') return webGpuScalarFieldShaderSource(shader);
  const fill = shader.hasFill ? 'fillCoverage' : '0.0';
  const boundary = shader.hasBoundary ? 'boundaryCoverage' : '0.0';
  return `
    struct RelationUniforms {
      xRow: vec4f,
      yRow: vec4f,
      viewport: vec4f,
      faceColor: vec4f,
      edgeColor: vec4f,
      selectionColor: vec4f,
      geometry: vec4f,
      interaction: vec4f,
    }
    @group(0) @binding(0) var<uniform> uniforms: RelationUniforms;

    struct RelationVertexOutput {
      @builtin(position) position: vec4f,
      @location(0) screen: vec2f,
    }

    @vertex fn relationVertex(@builtin(vertex_index) index: u32) -> RelationVertexOutput {
      let positions = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(-1.0, 3.0), vec2f(3.0, -1.0));
      let position = positions[index];
      var output: RelationVertexOutput;
      output.position = vec4f(position, 0.0, 1.0);
      output.screen = vec2f(
        (position.x + 1.0) * 0.5 * uniforms.viewport.x,
        (1.0 - position.y) * 0.5 * uniforms.viewport.y
      );
      return output;
    }

    fn over(foreground: vec4f, background: vec4f) -> vec4f {
      let alpha = foreground.a + background.a * (1.0 - foreground.a);
      if (alpha <= 0.000001) { return vec4f(0.0); }
      return vec4f(
        (foreground.rgb * foreground.a + background.rgb * background.a * (1.0 - foreground.a)) / alpha,
        alpha
      );
    }

    @fragment fn relationFragment(input: RelationVertexOutput) -> @location(0) vec4f {
      let a = uniforms.xRow.x;
      let c = uniforms.xRow.y;
      let e = uniforms.xRow.z;
      let b = uniforms.yRow.x;
      let d = uniforms.yRow.y;
      let f = uniforms.yRow.z;
      let determinant = a * d - b * c;
      let translated = input.screen - vec2f(e, f);
      let local = vec2f(
        (d * translated.x - c * translated.y) / determinant,
        (-b * translated.x + a * translated.y) / determinant
      );
      let x = local.x;
      let y = local.y;
      let t = uniforms.interaction.z;
      let boundaryResidual = ${shader.wgslBoundaryResidual};
      let boundaryGradient = max(length(vec2f(dpdx(boundaryResidual), dpdy(boundaryResidual))), 0.0000001);
      let boundaryDistancePx = boundaryResidual / boundaryGradient;
      let fillResidual = ${shader.wgslFillResidual};
      let fillGradient = max(length(vec2f(dpdx(fillResidual), dpdy(fillResidual))), 0.0000001);
      let fillDistancePx = fillResidual / fillGradient;
      let insidePx = fillDistancePx * ${shader.insideSign.toFixed(1)};
      let fillCoverage = smoothstep(-0.75, 0.75, insidePx);
      let edgeHalfWidth = uniforms.geometry.x * 0.5;
      let boundaryCoverage = 1.0 - smoothstep(edgeHalfWidth - 0.75, edgeHalfWidth + 0.75, abs(boundaryDistancePx));
      let selectionCenter = edgeHalfWidth + uniforms.geometry.y + uniforms.geometry.z * 0.5;
      let selectionDelta = abs(abs(boundaryDistancePx) - selectionCenter);
      let edgeSelection = (1.0 - smoothstep(
        uniforms.geometry.z * 0.5 - 0.75,
        uniforms.geometry.z * 0.5 + 0.75,
        selectionDelta
      )) * uniforms.interaction.x;
      var color = vec4f(uniforms.faceColor.rgb, uniforms.faceColor.a * ${fill});
      color = over(vec4f(uniforms.selectionColor.rgb, fillCoverage * uniforms.interaction.y), color);
      color = over(vec4f(uniforms.selectionColor.rgb, edgeSelection), color);
      color = over(vec4f(uniforms.edgeColor.rgb, uniforms.edgeColor.a * ${boundary}), color);
      return color;
    }

    @fragment fn relationPickFragment(input: RelationVertexOutput) -> @location(0) u32 {
      let a = uniforms.xRow.x;
      let c = uniforms.xRow.y;
      let e = uniforms.xRow.z;
      let b = uniforms.yRow.x;
      let d = uniforms.yRow.y;
      let f = uniforms.yRow.z;
      let determinant = a * d - b * c;
      let translated = input.screen - vec2f(e, f);
      let local = vec2f(
        (d * translated.x - c * translated.y) / determinant,
        (-b * translated.x + a * translated.y) / determinant
      );
      let x = local.x;
      let y = local.y;
      let t = uniforms.interaction.z;
      let boundaryResidual = ${shader.wgslBoundaryResidual};
      let boundaryGradient = max(length(vec2f(dpdx(boundaryResidual), dpdy(boundaryResidual))), 0.0000001);
      let boundaryDistancePx = boundaryResidual / boundaryGradient;
      let fillResidual = ${shader.wgslFillResidual};
      let fillGradient = max(length(vec2f(dpdx(fillResidual), dpdy(fillResidual))), 0.0000001);
      let fillDistancePx = fillResidual / fillGradient;
      let insidePx = fillDistancePx * ${shader.insideSign.toFixed(1)};
      if (${shader.hasBoundary ? 'abs(boundaryDistancePx) <= uniforms.geometry.x * 0.5 + uniforms.geometry.w' : 'false'}) {
        return 2u;
      }
      if (${shader.hasFill ? 'insidePx >= 0.0' : 'false'}) { return 1u; }
      discard;
      return 0u;
    }
  `;
}

export function webGpuShaderSource() {
  return `
    struct View {
      xRow: vec4f,
      yRow: vec4f,
      viewport: vec4f,
    }
    @group(0) @binding(0) var<uniform> view: View;
    struct Stroke {
      geometry: vec4f,
      color: vec4f,
    }
    @group(0) @binding(1) var<uniform> stroke: Stroke;

    struct PlotInput {
      @location(0) position: vec2f,
      @location(1) color: vec4f,
    }
    struct PlotOutput {
      @builtin(position) position: vec4f,
      @location(0) color: vec4f,
    }
    struct PointOutput {
      @builtin(position) position: vec4f,
      @location(0) color: vec4f,
      @location(1) unitOffset: vec2f,
    }
    struct StrokeOutput {
      @builtin(position) position: vec4f,
      @location(0) color: vec4f,
      @location(1) screenPosition: vec2f,
      @location(2) halfWidth: f32,
      @location(3) innerHalfWidth: f32,
      @location(4) @interpolate(flat) previousScreen: vec2f,
      @location(5) @interpolate(flat) fromScreen: vec2f,
      @location(6) @interpolate(flat) toScreen: vec2f,
      @location(7) @interpolate(flat) nextScreen: vec2f,
    }
    struct StrokeInput {
      @location(2) previousPosition: vec2f,
      @location(3) fromPosition: vec2f,
      @location(4) fromColor: vec4f,
      @location(5) toPosition: vec2f,
      @location(6) toColor: vec4f,
      @location(7) nextPosition: vec2f,
      @location(8) strokeScale: f32,
    }
    struct PickOutput {
      @builtin(position) position: vec4f,
      @location(0) @interpolate(flat) id: u32,
    }

    fn project(position: vec2f) -> vec4f {
      let value = vec3f(position, 1.0);
      let screen = vec2f(dot(view.xRow.xyz, value), dot(view.yRow.xyz, value));
      return vec4f(
        screen.x / view.viewport.x * 2.0 - 1.0,
        1.0 - screen.y / view.viewport.y * 2.0,
        0.0,
        1.0
      );
    }

    @vertex fn plotVertex(input: PlotInput) -> PlotOutput {
      var output: PlotOutput;
      output.position = project(input.position);
      output.color = input.color;
      return output;
    }

    @vertex fn pointVertex(input: PlotInput, @builtin(vertex_index) vertexIndex: u32) -> PointOutput {
      let corners = array<vec2f, ${SYMBOLIC_PLOT_POINT_VERTICES}>(
        vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
        vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0)
      );
      let unitOffset = corners[vertexIndex];
      let value = vec3f(input.position, 1.0);
      let center = vec2f(dot(view.xRow.xyz, value), dot(view.yRow.xyz, value));
      let screen = center + unitOffset * ${SYMBOLIC_PLOT_POINT_RADIUS.toFixed(1)};
      var output: PointOutput;
      output.position = vec4f(
        screen.x / view.viewport.x * 2.0 - 1.0,
        1.0 - screen.y / view.viewport.y * 2.0,
        0.0,
        1.0
      );
      output.color = input.color;
      output.unitOffset = unitOffset;
      return output;
    }

    @vertex fn selectionFaceVertex(input: PlotInput) -> PlotOutput {
      var output: PlotOutput;
      output.position = project(input.position);
      output.color = stroke.color;
      return output;
    }

    @vertex fn pickFaceVertex(input: PlotInput, @builtin(vertex_index) vertexIndex: u32) -> PickOutput {
      var output: PickOutput;
      output.position = project(input.position);
      output.id = vertexIndex / 3u + 1u;
      return output;
    }

    @vertex fn strokeVertex(input: StrokeInput, @builtin(vertex_index) vertexIndex: u32) -> StrokeOutput {
      let along = select(1.0, 0.0, vertexIndex == 0u || vertexIndex == 1u || vertexIndex == 3u);
      let side = select(-1.0, 1.0, vertexIndex == 0u || vertexIndex == 3u || vertexIndex == 5u);
      let fromScreen = vec2f(dot(view.xRow.xyz, vec3f(input.fromPosition, 1.0)), dot(view.yRow.xyz, vec3f(input.fromPosition, 1.0)));
      let toScreen = vec2f(dot(view.xRow.xyz, vec3f(input.toPosition, 1.0)), dot(view.yRow.xyz, vec3f(input.toPosition, 1.0)));
      let previousScreen = vec2f(dot(view.xRow.xyz, vec3f(input.previousPosition, 1.0)), dot(view.yRow.xyz, vec3f(input.previousPosition, 1.0)));
      let nextScreen = vec2f(dot(view.xRow.xyz, vec3f(input.nextPosition, 1.0)), dot(view.yRow.xyz, vec3f(input.nextPosition, 1.0)));
      let halfWidth = stroke.geometry.x * input.strokeScale * 0.5;
      let outerRadius = halfWidth + 1.0;
      let segment = toScreen - fromScreen;
      let direction = segment / max(length(segment), 0.0001);
      let normal = vec2f(-direction.y, direction.x);
      let center = mix(fromScreen - direction * outerRadius, toScreen + direction * outerRadius, along);
      let screen = center + normal * (side * outerRadius + stroke.geometry.y);
      var output: StrokeOutput;
      output.position = vec4f(screen.x / view.viewport.x * 2.0 - 1.0, 1.0 - screen.y / view.viewport.y * 2.0, 0.0, 1.0);
      output.color = select(mix(input.fromColor, input.toColor, along), stroke.color, stroke.geometry.z > 0.5);
      output.screenPosition = screen;
      output.halfWidth = halfWidth;
      output.innerHalfWidth = stroke.geometry.w;
      output.previousScreen = previousScreen;
      output.fromScreen = fromScreen;
      output.toScreen = toScreen;
      output.nextScreen = nextScreen;
      return output;
    }

    @vertex fn pickStrokeVertex(
      input: StrokeInput,
      @builtin(vertex_index) vertexIndex: u32,
      @builtin(instance_index) instanceIndex: u32
    ) -> PickOutput {
      let along = select(1.0, 0.0, vertexIndex == 0u || vertexIndex == 1u || vertexIndex == 3u);
      let side = select(-1.0, 1.0, vertexIndex == 0u || vertexIndex == 3u || vertexIndex == 5u);
      let fromScreen = vec2f(dot(view.xRow.xyz, vec3f(input.fromPosition, 1.0)), dot(view.yRow.xyz, vec3f(input.fromPosition, 1.0)));
      let toScreen = vec2f(dot(view.xRow.xyz, vec3f(input.toPosition, 1.0)), dot(view.yRow.xyz, vec3f(input.toPosition, 1.0)));
      let delta = toScreen - fromScreen;
      let normal = vec2f(-delta.y, delta.x) / max(length(delta), 0.0001);
      let screen = mix(fromScreen, toScreen, along) + normal * side * stroke.geometry.x * input.strokeScale * 0.5;
      var output: PickOutput;
      output.position = vec4f(screen.x / view.viewport.x * 2.0 - 1.0, 1.0 - screen.y / view.viewport.y * 2.0, 0.0, 1.0);
      output.id = bitcast<u32>(stroke.geometry.w) + instanceIndex + 1u;
      return output;
    }

    @fragment fn plotFragment(input: PlotOutput) -> @location(0) vec4f {
      return input.color;
    }

    fn distanceToSegment(point: vec2f, fromPoint: vec2f, toPoint: vec2f) -> f32 {
      let segment = toPoint - fromPoint;
      let lengthSquared = dot(segment, segment);
      let along = clamp(dot(point - fromPoint, segment) / max(lengthSquared, 0.000001), 0.0, 1.0);
      return length(point - (fromPoint + segment * along));
    }

    @fragment fn selectionMaskFragment(input: StrokeOutput) -> @location(0) vec4f {
      let distance = distanceToSegment(input.screenPosition, input.fromScreen, input.toScreen);
      let antialias = max(fwidth(distance), 0.0001);
      let outerCoverage = 1.0 - smoothstep(
        input.halfWidth,
        input.halfWidth + antialias,
        distance
      );
      let innerCoverage = 1.0 - smoothstep(
        input.innerHalfWidth,
        input.innerHalfWidth + antialias,
        distance
      );
      return vec4f(outerCoverage, innerCoverage, 0.0, 0.0);
    }

    @fragment fn strokeFragment(input: StrokeOutput) -> @location(0) vec4f {
      let distance = distanceToSegment(input.screenPosition, input.fromScreen, input.toScreen);
      let antialias = max(fwidth(distance), 0.0001);
      let outerCoverage = 1.0 - smoothstep(
        input.halfWidth,
        input.halfWidth + antialias,
        distance
      );
      let innerCoverage = select(
        1.0,
        smoothstep(
          input.innerHalfWidth - antialias,
          input.innerHalfWidth + antialias,
          distance
        ),
        input.innerHalfWidth > 0.0
      );
      let coverage = outerCoverage * innerCoverage;
      return vec4f(input.color.rgb, input.color.a * coverage);
    }

    @fragment fn pointFragment(input: PointOutput) -> @location(0) vec4f {
      let distance = length(input.unitOffset);
      let antialias = max(fwidth(distance), 0.0001);
      let coverage = 1.0 - smoothstep(1.0 - antialias, 1.0, distance);
      return vec4f(input.color.rgb, input.color.a * coverage);
    }

    @fragment fn pickFragment(input: PickOutput) -> @location(0) u32 {
      return input.id;
    }

    @vertex fn clipVertex(@location(0) position: vec2f) -> @builtin(position) vec4f {
      return project(position);
    }

    @fragment fn clipFragment() -> @location(0) vec4f {
      return vec4f(0.0);
    }

    @fragment fn pickClipFragment() -> @location(0) u32 {
      return 0u;
    }
  `;
}

export function webGpuSelectionCompositeShaderSource() {
  return `
    struct SelectionAppearance {
      color: vec4f,
    }
    @group(0) @binding(0) var selectionMask: texture_2d<f32>;
    @group(0) @binding(1) var<uniform> selection: SelectionAppearance;

    @vertex fn selectionCompositeVertex(@builtin(vertex_index) vertexIndex: u32) -> @builtin(position) vec4f {
      let positions = array<vec2f, 3>(
        vec2f(-1.0, -1.0),
        vec2f(3.0, -1.0),
        vec2f(-1.0, 3.0)
      );
      return vec4f(positions[vertexIndex], 0.0, 1.0);
    }

    @fragment fn selectionCompositeFragment(@builtin(position) position: vec4f) -> @location(0) vec4f {
      let mask = textureLoad(selectionMask, vec2i(position.xy), 0).rg;
      let ringCoverage = mask.r * (1.0 - mask.g);
      return vec4f(selection.color.rgb, selection.color.a * ringCoverage);
    }
  `;
}

function createWebGl2Backend(canvas) {
  const gl = canvas.getContext('webgl2', {
    alpha: true,
    antialias: true,
    premultipliedAlpha: true,
    stencil: true
  });
  if (!gl) return null;
  if (gl.getContextAttributes?.()?.stencil !== true) return null;
  const plotProgram = createWebGlProgram(gl, webGlVertexSource(true), webGlFragmentSource(true));
  const pointProgram = createWebGlProgram(gl, webGlPointVertexSource(), webGlPointFragmentSource());
  const faceSelectionProgram = createWebGlProgram(gl, webGlVertexSource(false), webGlSolidFragmentSource());
  const clipProgram = createWebGlProgram(gl, webGlVertexSource(false), webGlFragmentSource(false));
  const strokeProgram = createWebGlProgram(gl, webGlStrokeVertexSource(), webGlStrokeFragmentSource());
  const selectionMaskProgram = createWebGlProgram(gl, webGlStrokeVertexSource(), webGlSelectionMaskFragmentSource());
  const selectionCompositeProgram = createWebGlProgram(
    gl, webGlSelectionCompositeVertexSource(), webGlSelectionCompositeFragmentSource()
  );
  const pickProgram = createWebGlProgram(gl, webGlPickVertexSource(), webGlPickFragmentSource());
  const facePickProgram = createWebGlProgram(gl, webGlFacePickVertexSource(), webGlPickFragmentSource());
  const plotBuffer = gl.createBuffer();
  const clipBuffer = gl.createBuffer();
  const segmentBuffer = gl.createBuffer();
  const pickFramebuffer = gl.createFramebuffer();
  const pickTexture = gl.createTexture();
  const pickStencil = gl.createRenderbuffer();
  const selectionFramebuffer = gl.createFramebuffer();
  const selectionTexture = gl.createTexture();
  const plotLocations = getWebGlLocations(gl, plotProgram, true);
  const pointLocations = getWebGlLocations(gl, pointProgram, true);
  const faceSelectionLocations = {
    ...getWebGlLocations(gl, faceSelectionProgram, false),
    solidColor: gl.getUniformLocation(faceSelectionProgram, 'u_color')
  };
  const clipLocations = getWebGlLocations(gl, clipProgram, false);
  const strokeLocations = getWebGlStrokeLocations(gl, strokeProgram);
  const selectionMaskLocations = getWebGlStrokeLocations(gl, selectionMaskProgram);
  const selectionCompositeLocations = {
    mask: gl.getUniformLocation(selectionCompositeProgram, 'u_selection_mask'),
    color: gl.getUniformLocation(selectionCompositeProgram, 'u_selection_color')
  };
  const pickLocations = getWebGlPickLocations(gl, pickProgram);
  const facePickLocations = getWebGlLocations(gl, facePickProgram, false);
  let plotCapacity = 0;
  let clipCapacity = 0;
  let segmentCapacity = 0;
  let clipDraws = Object.freeze([]);
  let currentArena = null;
  let appearance = normalizeSymbolicPlotAppearance();
  let transform = [...DEFAULT_TRANSFORM];
  let cssSize = [1, 1];
  let relation = null;
  let relationProgram = null;
  let relationLocations = null;
  let relationPickProgram = null;
  let relationPickLocations = null;

  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

  return {
    kind: 'webgl2',
    resize(width, height) {
      cssSize = [width, height];
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.bindTexture(gl.TEXTURE_2D, pickTexture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, canvas.width, canvas.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.bindRenderbuffer(gl.RENDERBUFFER, pickStencil);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH24_STENCIL8, canvas.width, canvas.height);
      gl.bindFramebuffer(gl.FRAMEBUFFER, pickFramebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, pickTexture, 0);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_STENCIL_ATTACHMENT, gl.RENDERBUFFER, pickStencil);
      gl.bindTexture(gl.TEXTURE_2D, selectionTexture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, canvas.width, canvas.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, selectionFramebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, selectionTexture, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    },
    updateTransform(nextTransform) {
      transform = [...nextTransform];
    },
    updateClip(geometry) {
      clipDraws = symbolicPlotClipStencilDraws(geometry);
      clipCapacity = uploadWebGlDynamicBuffer(gl, clipBuffer, geometry.vertices, clipCapacity);
    },
    updateAppearance(nextAppearance) {
      appearance = nextAppearance;
    },
    updateRelation(nextRelation) {
      const nextKey = relationShaderKey(nextRelation?.shader);
      const currentKey = relationShaderKey(relation?.shader);
      relation = nextRelation;
      if (nextKey === currentKey) return;
      if (relationProgram) gl.deleteProgram(relationProgram);
      if (relationPickProgram) gl.deleteProgram(relationPickProgram);
      relationProgram = nextRelation
        ? createWebGlProgram(gl, webGlRelationVertexSource(), webGlRelationFragmentSource(nextRelation.shader))
        : null;
      relationPickProgram = nextRelation
        ? createWebGlProgram(gl, webGlRelationVertexSource(), webGlRelationPickFragmentSource(nextRelation.shader))
        : null;
      relationLocations = relationProgram ? getWebGlRelationLocations(gl, relationProgram) : null;
      relationPickLocations = relationPickProgram ? {
        ...getWebGlRelationLocations(gl, relationPickProgram),
        pickRadius: gl.getUniformLocation(relationPickProgram, 'u_pick_radius')
      } : null;
    },
    render(arena, upload) {
      currentArena = arena;
      gl.viewport(0, 0, canvas.width, canvas.height);
      if (!currentArena) {
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
        return;
      }
      if (upload) {
        plotCapacity = uploadWebGlDynamicBuffer(
          gl, plotBuffer, currentArena.data, plotCapacity
        );
        segmentCapacity = uploadWebGlDynamicBuffer(
          gl, segmentBuffer, currentArena.segments, segmentCapacity
        );
      }
      if (currentArena && appearance.edgeSelectionAlpha > 0 && currentArena.segmentCount) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, selectionFramebuffer);
        gl.disable(gl.STENCIL_TEST);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.blendEquation(gl.MAX);
        gl.blendFunc(gl.ONE, gl.ONE);
        drawWebGlSelectionMask(
          gl, selectionMaskProgram, segmentBuffer, selectionMaskLocations,
          transform, cssSize, currentArena.segmentCount, appearance
        );
        gl.blendEquation(gl.FUNC_ADD);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      }
      gl.clearColor(0, 0, 0, 0);
      gl.clearStencil(0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);

      const clipped = clipDraws.length > 0;
      if (clipped) drawWebGlClip(gl, clipProgram, clipBuffer, clipLocations, transform, cssSize, clipDraws);
      if (relation && relationProgram) {
        drawWebGlRelation(gl, relationProgram, relationLocations, transform, cssSize, canvas, relation, appearance, clipped);
        return;
      }
      drawWebGlArena(
        gl,
        plotProgram,
        plotBuffer,
        plotLocations,
        transform,
        cssSize,
        currentArena,
        clipped
      );
      drawWebGlPoints(
        gl, pointProgram, plotBuffer, pointLocations,
        transform, cssSize, currentArena, clipped
      );
      if (appearance.faceSelectionAlpha > 0) {
        drawWebGlFaceSelection(
          gl, faceSelectionProgram, plotBuffer, faceSelectionLocations,
          transform, cssSize, currentArena, appearance, clipped
        );
      }
      if (appearance.edgeSelectionAlpha > 0 && currentArena.segmentCount) {
        drawWebGlSelectionComposite(
          gl, selectionCompositeProgram, selectionCompositeLocations,
          selectionTexture, appearance, clipped
        );
      }
      drawWebGlStrokes(
        gl,
        strokeProgram,
        segmentBuffer,
        strokeLocations,
        transform,
        cssSize,
        currentArena.segmentCount,
        appearance,
        clipped
      );
    },
    async pick(request) {
      if (!relation && (!currentArena || (!currentArena.segmentCount && !currentArena.primitives.facePickCapacity))) return null;
      const previousFramebuffer = gl.getParameter(gl.FRAMEBUFFER_BINDING);
      const blendEnabled = gl.isEnabled(gl.BLEND);
      const scaleX = canvas.width / cssSize[0];
      const scaleY = canvas.height / cssSize[1];
      const pixelX = Math.min(canvas.width - 1, Math.floor(request.x * scaleX));
      const pixelY = Math.min(canvas.height - 1, Math.floor(request.y * scaleY));
      const readY = canvas.height - pixelY - 1;
      gl.bindFramebuffer(gl.FRAMEBUFFER, pickFramebuffer);
      gl.disable(gl.BLEND);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(pixelX, readY, 1, 1);
      gl.clearColor(0, 0, 0, 0);
      gl.clearStencil(0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
      const clipped = clipDraws.length > 0;
      if (clipped) drawWebGlClip(gl, clipProgram, clipBuffer, clipLocations, transform, cssSize, clipDraws);
      if (relation && relationPickProgram) {
        drawWebGlRelation(
          gl, relationPickProgram, relationPickLocations, transform, cssSize, canvas,
          relation, appearance, clipped, request.radius
        );
      } else {
      drawWebGlFacePick(
        gl, facePickProgram, plotBuffer, facePickLocations,
        transform, cssSize, currentArena, clipped
      );
      drawWebGlPick(
        gl,
        pickProgram,
        segmentBuffer,
        pickLocations,
        transform,
        cssSize,
        currentArena.segmentCount,
        appearance.edgeWidth + request.radius * 2,
        currentArena.primitives.facePickCapacity,
        clipped
      );
      }
      const pixel = new Uint8Array(4);
      gl.readPixels(pixelX, readY, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      gl.disable(gl.SCISSOR_TEST);
      if (blendEnabled) gl.enable(gl.BLEND);
      gl.bindFramebuffer(gl.FRAMEBUFFER, previousFramebuffer);
      gl.viewport(0, 0, canvas.width, canvas.height);
      const value = (pixel[0] | (pixel[1] << 8) | (pixel[2] << 16) | (pixel[3] << 24)) >>> 0;
      if (!value) return null;
      if (relation) return Object.freeze({ kind: value === 2 ? 'relation-edge' : 'relation-face', index: 0 });
      return value <= currentArena.primitives.facePickCapacity
        ? Object.freeze({ kind: 'triangle', index: value - 1 })
        : Object.freeze({ kind: 'segment', index: value - currentArena.primitives.facePickCapacity - 1 });
    },
    destroy() {
      gl.deleteBuffer(plotBuffer);
      gl.deleteBuffer(clipBuffer);
      gl.deleteBuffer(segmentBuffer);
      gl.deleteFramebuffer(pickFramebuffer);
      gl.deleteTexture(pickTexture);
      gl.deleteRenderbuffer(pickStencil);
      gl.deleteFramebuffer(selectionFramebuffer);
      gl.deleteTexture(selectionTexture);
      gl.deleteProgram(plotProgram);
      gl.deleteProgram(pointProgram);
      gl.deleteProgram(faceSelectionProgram);
      gl.deleteProgram(clipProgram);
      gl.deleteProgram(strokeProgram);
      gl.deleteProgram(selectionMaskProgram);
      gl.deleteProgram(selectionCompositeProgram);
      gl.deleteProgram(pickProgram);
      gl.deleteProgram(facePickProgram);
      if (relationProgram) gl.deleteProgram(relationProgram);
      if (relationPickProgram) gl.deleteProgram(relationPickProgram);
    }
  };
}

function drawWebGlClip(gl, program, buffer, locations, transform, size, draws) {
  gl.enable(gl.STENCIL_TEST);
  gl.stencilMask(0xff);
  gl.stencilOp(gl.KEEP, gl.KEEP, gl.REPLACE);
  gl.colorMask(false, false, false, false);
  gl.useProgram(program);
  setWebGlView(gl, locations, transform, size);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.enableVertexAttribArray(locations.position);
  gl.vertexAttribPointer(locations.position, 2, gl.FLOAT, false, 8, 0);
  for (const draw of draws) {
    gl.stencilFunc(gl.ALWAYS, draw.reference, 0xff);
    gl.drawArrays(gl.TRIANGLES, draw.first, draw.count);
  }
  gl.colorMask(true, true, true, true);
  gl.stencilMask(0);
  gl.stencilFunc(gl.EQUAL, 1, 0xff);
}

function drawWebGlArena(gl, program, buffer, locations, transform, size, arena, clipped) {
  if (!clipped) gl.disable(gl.STENCIL_TEST);
  gl.useProgram(program);
  setWebGlView(gl, locations, transform, size);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.enableVertexAttribArray(locations.position);
  gl.vertexAttribPointer(locations.position, 2, gl.FLOAT, false, BYTES_PER_VERTEX, 0);
  gl.enableVertexAttribArray(locations.color);
  gl.vertexAttribPointer(locations.color, 4, gl.FLOAT, false, BYTES_PER_VERTEX, 8);
  for (const range of arena.ranges) {
    if (!range.count) continue;
    if (['point-list', 'line-list', 'line-strip'].includes(range.topology)) continue;
    gl.drawArrays(webGlTopology(gl, range.topology), range.first, range.count);
  }
  gl.disable(gl.STENCIL_TEST);
  gl.stencilMask(0xff);
}

function drawWebGlPoints(gl, program, buffer, locations, transform, size, arena, clipped) {
  if (clipped) {
    gl.enable(gl.STENCIL_TEST);
    gl.stencilMask(0);
    gl.stencilFunc(gl.EQUAL, 1, 0xff);
  } else {
    gl.disable(gl.STENCIL_TEST);
  }
  gl.useProgram(program);
  setWebGlView(gl, locations, transform, size);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.enableVertexAttribArray(locations.position);
  gl.enableVertexAttribArray(locations.color);
  gl.vertexAttribDivisor(locations.position, 1);
  gl.vertexAttribDivisor(locations.color, 1);
  for (const draw of symbolicPlotPointDraws(arena)) {
    const offset = draw.first * BYTES_PER_VERTEX;
    gl.vertexAttribPointer(locations.position, 2, gl.FLOAT, false, BYTES_PER_VERTEX, offset);
    gl.vertexAttribPointer(locations.color, 4, gl.FLOAT, false, BYTES_PER_VERTEX, offset + 8);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, draw.verticesPerInstance, draw.count);
  }
  gl.vertexAttribDivisor(locations.position, 0);
  gl.vertexAttribDivisor(locations.color, 0);
  gl.disable(gl.STENCIL_TEST);
  gl.stencilMask(0xff);
}

function drawWebGlFaceSelection(gl, program, buffer, locations, transform, size, arena, appearance, clipped) {
  if (clipped) {
    gl.enable(gl.STENCIL_TEST);
    gl.stencilMask(0);
    gl.stencilFunc(gl.EQUAL, 1, 0xff);
  } else {
    gl.disable(gl.STENCIL_TEST);
  }
  gl.useProgram(program);
  setWebGlView(gl, locations, transform, size);
  gl.uniform4f(
    locations.solidColor,
    appearance.selectionColor[0], appearance.selectionColor[1], appearance.selectionColor[2], appearance.faceSelectionAlpha
  );
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.enableVertexAttribArray(locations.position);
  gl.vertexAttribPointer(locations.position, 2, gl.FLOAT, false, BYTES_PER_VERTEX, 0);
  for (const range of arena.ranges) {
    if (range.part === 'face' && range.topology === 'triangle-list' && range.count) {
      gl.drawArrays(gl.TRIANGLES, range.first, range.count);
    }
  }
  gl.disable(gl.STENCIL_TEST);
  gl.stencilMask(0xff);
}

function drawWebGlStrokes(gl, program, buffer, locations, transform, size, count, appearance, clipped) {
  if (!count) return;
  if (clipped) {
    gl.enable(gl.STENCIL_TEST);
    gl.stencilMask(0);
    gl.stencilFunc(gl.EQUAL, 1, 0xff);
  } else {
    gl.disable(gl.STENCIL_TEST);
  }
  gl.useProgram(program);
  setWebGlView(gl, locations, transform, size);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  const attributes = [
    [locations.previousPosition, 2, 0],
    [locations.fromPosition, 2, 8],
    [locations.fromColor, 4, 16],
    [locations.toPosition, 2, 32],
    [locations.toColor, 4, 40],
    [locations.nextPosition, 2, 56],
    [locations.strokeScale, 1, 64]
  ];
  const enabledAttributes = bindWebGlInstancedAttributes(gl, attributes);
  const draw = (width, offset, color, alpha, override, innerHalfWidth = 0) => {
    gl.uniform1f(locations.width, width);
    gl.uniform1f(locations.offset, offset);
    gl.uniform1f(locations.innerHalfWidth, innerHalfWidth);
    gl.uniform1f(locations.override, override ? 1 : 0);
    gl.uniform4f(locations.overrideColor, color[0], color[1], color[2], alpha);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, count);
  };
  draw(appearance.edgeWidth, 0, [0, 0, 0], 0, false);
  for (const location of enabledAttributes) gl.vertexAttribDivisor(location, 0);
  gl.disable(gl.STENCIL_TEST);
  gl.stencilMask(0xff);
}

function drawWebGlPick(gl, program, buffer, locations, transform, size, count, width, pickBase, clipped) {
  if (!count) return;
  if (clipped) {
    gl.enable(gl.STENCIL_TEST);
    gl.stencilMask(0);
    gl.stencilFunc(gl.EQUAL, 1, 0xff);
  } else {
    gl.disable(gl.STENCIL_TEST);
  }
  gl.useProgram(program);
  setWebGlView(gl, locations, transform, size);
  gl.uniform1f(locations.width, width);
  gl.uniform1ui(locations.pickBase, pickBase);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  for (const [location, sizeValue, offset] of [
    [locations.fromPosition, 2, 8],
    [locations.toPosition, 2, 32],
    [locations.strokeScale, 1, 64]
  ]) {
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, sizeValue, gl.FLOAT, false, FLOATS_PER_SEGMENT * 4, offset);
    gl.vertexAttribDivisor(location, 1);
  }
  gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, count);
  gl.vertexAttribDivisor(locations.fromPosition, 0);
  gl.vertexAttribDivisor(locations.toPosition, 0);
  gl.vertexAttribDivisor(locations.strokeScale, 0);
  gl.disable(gl.STENCIL_TEST);
  gl.stencilMask(0xff);
}

function drawWebGlFacePick(gl, program, buffer, locations, transform, size, arena, clipped) {
  if (clipped) {
    gl.enable(gl.STENCIL_TEST);
    gl.stencilMask(0);
    gl.stencilFunc(gl.EQUAL, 1, 0xff);
  } else {
    gl.disable(gl.STENCIL_TEST);
  }
  gl.useProgram(program);
  setWebGlView(gl, locations, transform, size);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.enableVertexAttribArray(locations.position);
  gl.vertexAttribPointer(locations.position, 2, gl.FLOAT, false, BYTES_PER_VERTEX, 0);
  for (const range of arena.ranges) {
    if (range.part === 'face' && range.topology === 'triangle-list' && range.count) {
      gl.drawArrays(gl.TRIANGLES, range.first, range.count);
    }
  }
  gl.disable(gl.STENCIL_TEST);
  gl.stencilMask(0xff);
}

function getWebGlLocations(gl, program, withColor) {
  return {
    position: gl.getAttribLocation(program, 'a_position'),
    color: withColor ? gl.getAttribLocation(program, 'a_color') : -1,
    transform: gl.getUniformLocation(program, 'u_transform'),
    viewport: gl.getUniformLocation(program, 'u_viewport')
  };
}

function getWebGlStrokeLocations(gl, program) {
  return {
    previousPosition: gl.getAttribLocation(program, 'a_previous_position'),
    fromPosition: gl.getAttribLocation(program, 'a_from_position'),
    fromColor: gl.getAttribLocation(program, 'a_from_color'),
    toPosition: gl.getAttribLocation(program, 'a_to_position'),
    toColor: gl.getAttribLocation(program, 'a_to_color'),
    nextPosition: gl.getAttribLocation(program, 'a_next_position'),
    strokeScale: gl.getAttribLocation(program, 'a_stroke_scale'),
    transform: gl.getUniformLocation(program, 'u_transform'),
    viewport: gl.getUniformLocation(program, 'u_viewport'),
    width: gl.getUniformLocation(program, 'u_width'),
    offset: gl.getUniformLocation(program, 'u_offset'),
    innerHalfWidth: gl.getUniformLocation(program, 'u_inner_half_width'),
    override: gl.getUniformLocation(program, 'u_override'),
    overrideColor: gl.getUniformLocation(program, 'u_override_color')
  };
}

function getWebGlPickLocations(gl, program) {
  return {
    fromPosition: gl.getAttribLocation(program, 'a_from_position'),
    toPosition: gl.getAttribLocation(program, 'a_to_position'),
    strokeScale: gl.getAttribLocation(program, 'a_stroke_scale'),
    transform: gl.getUniformLocation(program, 'u_transform'),
    viewport: gl.getUniformLocation(program, 'u_viewport'),
    width: gl.getUniformLocation(program, 'u_width'),
    pickBase: gl.getUniformLocation(program, 'u_pick_base')
  };
}

function getWebGlRelationLocations(gl, program) {
  return {
    transform: gl.getUniformLocation(program, 'u_transform'),
    viewport: gl.getUniformLocation(program, 'u_viewport'),
    time: gl.getUniformLocation(program, 'u_time'),
    faceColor: gl.getUniformLocation(program, 'u_face_color'),
    edgeColor: gl.getUniformLocation(program, 'u_edge_color'),
    selectionColor: gl.getUniformLocation(program, 'u_selection_color'),
    geometry: gl.getUniformLocation(program, 'u_geometry'),
    interaction: gl.getUniformLocation(program, 'u_interaction')
  };
}

function drawWebGlRelation(gl, program, locations, transform, size, canvas, relation, appearance, clipped, pickRadius = null) {
  if (clipped) {
    gl.enable(gl.STENCIL_TEST);
    gl.stencilMask(0);
    gl.stencilFunc(gl.EQUAL, 1, 0xff);
  } else {
    gl.disable(gl.STENCIL_TEST);
  }
  gl.useProgram(program);
  setWebGlView(gl, locations, transform, size);
  const style = relation.style;
  const ratio = Math.max(1, canvas.width / Math.max(1, size[0]));
  gl.uniform1f(locations.time, relation.t);
  gl.uniform4f(locations.faceColor, style.faceR, style.faceG, style.faceB, style.faceA);
  gl.uniform4f(locations.edgeColor, style.edgeR, style.edgeG, style.edgeB, style.edgeA);
  gl.uniform4f(
    locations.selectionColor,
    appearance.selectionColor[0], appearance.selectionColor[1], appearance.selectionColor[2], 1
  );
  gl.uniform4f(
    locations.geometry,
    appearance.edgeWidth * ratio,
    appearance.selectionGap * ratio,
    appearance.selectionWidth * ratio,
    ratio
  );
  gl.uniform2f(locations.interaction, appearance.edgeSelectionAlpha, appearance.faceSelectionAlpha);
  if (pickRadius != null && locations.pickRadius) gl.uniform1f(locations.pickRadius, pickRadius * ratio);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.disable(gl.STENCIL_TEST);
  gl.stencilMask(0xff);
}

function setWebGlView(gl, locations, transform, size) {
  const [a, b, c, d, e, f] = transform;
  gl.uniformMatrix3fv(locations.transform, false, new Float32Array([
    a, b, 0,
    c, d, 0,
    e, f, 1
  ]));
  gl.uniform2f(locations.viewport, size[0], size[1]);
}

function webGlTopology(gl, topology) {
  if (topology === 'point-list') return gl.POINTS;
  if (topology === 'line-list') return gl.LINES;
  if (topology === 'line-strip') return gl.LINE_STRIP;
  return gl.TRIANGLES;
}

function webGlVertexSource(withColor) {
  return `#version 300 es
    in vec2 a_position;
    ${withColor ? 'in vec4 a_color; out vec4 v_color;' : ''}
    uniform mat3 u_transform;
    uniform vec2 u_viewport;
    void main() {
      vec2 screen = (u_transform * vec3(a_position, 1.0)).xy;
      gl_Position = vec4(
        screen.x / u_viewport.x * 2.0 - 1.0,
        1.0 - screen.y / u_viewport.y * 2.0,
        0.0,
        1.0
      );
      ${withColor ? 'v_color = a_color;' : ''}
    }
  `;
}

export function webGlPointVertexSource() {
  return `#version 300 es
    in vec2 a_position;
    in vec4 a_color;
    uniform mat3 u_transform;
    uniform vec2 u_viewport;
    out vec4 v_color;
    out vec2 v_unit_offset;
    void main() {
      vec2 corners[${SYMBOLIC_PLOT_POINT_VERTICES}] = vec2[](
        vec2(-1.0, -1.0), vec2(1.0, -1.0), vec2(-1.0, 1.0),
        vec2(-1.0, 1.0), vec2(1.0, -1.0), vec2(1.0, 1.0)
      );
      vec2 unit_offset = corners[gl_VertexID];
      vec2 center = (u_transform * vec3(a_position, 1.0)).xy;
      vec2 screen = center + unit_offset * ${SYMBOLIC_PLOT_POINT_RADIUS.toFixed(1)};
      gl_Position = vec4(
        screen.x / u_viewport.x * 2.0 - 1.0,
        1.0 - screen.y / u_viewport.y * 2.0,
        0.0,
        1.0
      );
      v_color = a_color;
      v_unit_offset = unit_offset;
    }
  `;
}

export function webGlPointFragmentSource() {
  return `#version 300 es
    precision mediump float;
    in vec4 v_color;
    in vec2 v_unit_offset;
    out vec4 out_color;
    void main() {
      float distance_value = length(v_unit_offset);
      float antialias = max(fwidth(distance_value), 0.0001);
      float coverage = 1.0 - smoothstep(1.0 - antialias, 1.0, distance_value);
      out_color = vec4(v_color.rgb, v_color.a * coverage);
    }
  `;
}

function webGlRelationVertexSource() {
  return `#version 300 es
    uniform vec2 u_viewport;
    out vec2 v_screen;
    void main() {
      vec2 position = vec2(
        gl_VertexID == 2 ? 3.0 : -1.0,
        gl_VertexID == 1 ? 3.0 : -1.0
      );
      gl_Position = vec4(position, 0.0, 1.0);
      v_screen = vec2(
        (position.x + 1.0) * 0.5 * u_viewport.x,
        (1.0 - position.y) * 0.5 * u_viewport.y
      );
    }
  `;
}

export function webGlRelationFragmentSource(shader) {
  if (shader.kind === 'complex-field') return webGlComplexFieldFragmentSource(shader);
  if (shader.kind === 'scalar-field') return webGlScalarFieldFragmentSource(shader);
  const fill = shader.hasFill ? 'fill_coverage' : '0.0';
  const boundary = shader.hasBoundary ? 'boundary_coverage' : '0.0';
  return `#version 300 es
    precision highp float;
    in vec2 v_screen;
    uniform mat3 u_transform;
    uniform vec2 u_viewport;
    uniform float u_time;
    uniform vec4 u_face_color;
    uniform vec4 u_edge_color;
    uniform vec4 u_selection_color;
    uniform vec4 u_geometry;
    uniform vec2 u_interaction;
    out vec4 out_color;

    vec4 over(vec4 foreground, vec4 background) {
      float alpha = foreground.a + background.a * (1.0 - foreground.a);
      if (alpha <= 0.000001) return vec4(0.0);
      return vec4(
        (foreground.rgb * foreground.a + background.rgb * background.a * (1.0 - foreground.a)) / alpha,
        alpha
      );
    }

    void main() {
      vec2 local = (inverse(u_transform) * vec3(v_screen, 1.0)).xy;
      float x = local.x;
      float y = local.y;
      float t = u_time;
      float boundary_residual = ${shader.glslBoundaryResidual};
      float boundary_gradient = max(length(vec2(dFdx(boundary_residual), dFdy(boundary_residual))), 0.0000001);
      float boundary_distance_px = boundary_residual / boundary_gradient;
      float fill_residual = ${shader.glslFillResidual};
      float fill_gradient = max(length(vec2(dFdx(fill_residual), dFdy(fill_residual))), 0.0000001);
      float fill_distance_px = fill_residual / fill_gradient;
      float inside_px = fill_distance_px * ${shader.insideSign.toFixed(1)};
      float fill_coverage = smoothstep(-0.75, 0.75, inside_px);
      float edge_half_width = u_geometry.x * 0.5;
      float boundary_coverage = 1.0 - smoothstep(edge_half_width - 0.75, edge_half_width + 0.75, abs(boundary_distance_px));
      float selection_center = edge_half_width + u_geometry.y + u_geometry.z * 0.5;
      float selection_delta = abs(abs(boundary_distance_px) - selection_center);
      float edge_selection = (1.0 - smoothstep(u_geometry.z * 0.5 - 0.75, u_geometry.z * 0.5 + 0.75, selection_delta)) * u_interaction.x;
      vec4 color = vec4(u_face_color.rgb, u_face_color.a * ${fill});
      color = over(vec4(u_selection_color.rgb, fill_coverage * u_interaction.y), color);
      color = over(vec4(u_selection_color.rgb, edge_selection), color);
      color = over(vec4(u_edge_color.rgb, u_edge_color.a * ${boundary}), color);
      if (color.a <= 0.000001) discard;
      out_color = color;
    }
  `;
}

export function webGlRelationPickFragmentSource(shader) {
  if (shader.kind === 'scalar-field' || shader.kind === 'complex-field') {
    return webGlScalarFieldPickFragmentSource();
  }
  const faceHit = shader.hasFill ? 'inside_px >= 0.0' : 'false';
  return `#version 300 es
    precision highp float;
    in vec2 v_screen;
    uniform mat3 u_transform;
    uniform vec2 u_viewport;
    uniform float u_time;
    uniform vec4 u_face_color;
    uniform vec4 u_edge_color;
    uniform vec4 u_selection_color;
    uniform vec4 u_geometry;
    uniform vec2 u_interaction;
    uniform float u_pick_radius;
    out vec4 out_color;
    void main() {
      vec2 local = (inverse(u_transform) * vec3(v_screen, 1.0)).xy;
      float x = local.x;
      float y = local.y;
      float t = u_time;
      float boundary_residual = ${shader.glslBoundaryResidual};
      float boundary_gradient = max(length(vec2(dFdx(boundary_residual), dFdy(boundary_residual))), 0.0000001);
      float boundary_distance_px = boundary_residual / boundary_gradient;
      float fill_residual = ${shader.glslFillResidual};
      float fill_gradient = max(length(vec2(dFdx(fill_residual), dFdy(fill_residual))), 0.0000001);
      float fill_distance_px = fill_residual / fill_gradient;
      float inside_px = fill_distance_px * ${shader.insideSign.toFixed(1)};
      if (${shader.hasBoundary ? 'abs(boundary_distance_px) <= u_geometry.x * 0.5 + u_pick_radius' : 'false'}) {
        out_color = vec4(2.0 / 255.0, 0.0, 0.0, 0.0);
      } else if (${faceHit}) {
        out_color = vec4(1.0 / 255.0, 0.0, 0.0, 0.0);
      } else {
        discard;
      }
    }
  `;
}

function drawWebGlSelectionMask(gl, program, buffer, locations, transform, size, count, appearance) {
  const halo = symbolicPlotSelectionHalo(appearance);
  gl.useProgram(program);
  setWebGlView(gl, locations, transform, size);
  gl.uniform1f(locations.width, halo.width);
  gl.uniform1f(locations.offset, 0);
  gl.uniform1f(locations.innerHalfWidth, halo.innerHalfWidth);
  gl.uniform1f(locations.override, 1);
  gl.uniform4f(locations.overrideColor, 0, 0, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  const attributes = [
    [locations.previousPosition, 2, 0],
    [locations.fromPosition, 2, 8],
    [locations.fromColor, 4, 16],
    [locations.toPosition, 2, 32],
    [locations.toColor, 4, 40],
    [locations.nextPosition, 2, 56],
    [locations.strokeScale, 1, 64]
  ];
  for (const [location, sizeValue, offset] of attributes) {
    if (location < 0) continue;
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, sizeValue, gl.FLOAT, false, FLOATS_PER_SEGMENT * 4, offset);
    gl.vertexAttribDivisor(location, 1);
  }
  gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, count);
  for (const [location] of attributes) {
    if (location >= 0) gl.vertexAttribDivisor(location, 0);
  }
}

function drawWebGlSelectionComposite(gl, program, locations, texture, appearance, clipped) {
  if (clipped) {
    gl.enable(gl.STENCIL_TEST);
    gl.stencilMask(0);
    gl.stencilFunc(gl.EQUAL, 1, 0xff);
  } else {
    gl.disable(gl.STENCIL_TEST);
  }
  gl.useProgram(program);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.uniform1i(locations.mask, 0);
  gl.uniform4f(
    locations.color,
    appearance.selectionColor[0], appearance.selectionColor[1], appearance.selectionColor[2],
    appearance.edgeSelectionAlpha
  );
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.disable(gl.STENCIL_TEST);
  gl.stencilMask(0xff);
}

function shaderFloat(value) {
  const number = Number(value);
  const text = String(Number.isFinite(number) ? number : 0);
  return /[.eE]/.test(text) ? text : `${text}.0`;
}

function shaderColor(point, type) {
  const values = [...point.color, point.alpha].map(shaderFloat).join(', ');
  return `${type}(${values})`;
}

function scalarColormapFunction(shader, language) {
  const wgsl = language === 'wgsl';
  const type = wgsl ? 'vec4f' : 'vec4';
  const points = shader.colormapPoints;
  const first = points[0];
  const lines = [`${wgsl ? 'fn' : ''} texture${wgsl ? 'C' : '_c'}olor(unit: ${wgsl ? 'f32' : 'float'}) ${wgsl ? '->' : ''} ${type} {`];
  if (!wgsl) lines[0] = `vec4 texture_color(float unit) {`;
  lines.push(`  if (unit <= ${shaderFloat(first.pos)}) { return ${shaderColor(first, type)}; }`);
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const point = points[index];
    const amount = `(unit - ${shaderFloat(previous.pos)}) / ${shaderFloat(Math.max(1e-12, point.pos - previous.pos))}`;
    lines.push(`  if (unit <= ${shaderFloat(point.pos)}) { return mix(${shaderColor(previous, type)}, ${shaderColor(point, type)}, clamp(${amount}, 0.0, 1.0)); }`);
  }
  lines.push(`  return ${shaderColor(points.at(-1), type)};`, '}');
  return lines.join('\n');
}

function complexMathFunctions(language, expression) {
  const wgsl = language === 'wgsl';
  const type = wgsl ? 'vec2f' : 'vec2';
  const angle = wgsl ? 'atan2(z.y, z.x)' : 'atan(z.y, z.x)';
  const args = (names) => names.map((name) => wgsl ? `${name}: ${type}` : `${type} ${name}`).join(', ');
  const declaration = (name, names) => wgsl
    ? `fn ${name}(${args(names)}) -> ${type}`
    : `${type} ${name}(${args(names)})`;
  const uses = (name) => String(expression).includes(name);
  const usesPower = uses('complexPow');
  const functions = [];
  if (uses('complexMul') || usesPower) functions.push(`
    ${declaration('complexMul', ['a', 'b'])} {
      return ${type}(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x);
    }`);
  if (uses('complexDiv')) functions.push(`
    ${declaration('complexDiv', ['a', 'b'])} {
      ${wgsl ? 'let' : 'float'} denominator = max(dot(b, b), 1e-20);
      return ${type}((a.x * b.x + a.y * b.y) / denominator, (a.y * b.x - a.x * b.y) / denominator);
    }`);
  if (uses('complexLog') || usesPower) functions.push(`
    ${declaration('complexLog', ['z'])} {
      return ${type}(log(max(length(z), 1e-20)), ${angle});
    }`);
  if (uses('complexExp') || usesPower) functions.push(`
    ${declaration('complexExp', ['z'])} {
      ${wgsl ? 'let' : 'float'} scale = exp(z.x);
      return scale * ${type}(cos(z.y), sin(z.y));
    }`);
  if (usesPower) functions.push(`
    ${declaration('complexPow', ['a', 'b'])} { return complexExp(complexMul(b, complexLog(a))); }`);
  if (uses('complexSin')) functions.push(`
    ${declaration('complexSin', ['z'])} {
      ${wgsl ? 'let' : 'float'} expY = exp(z.y);
      ${wgsl ? 'let' : 'float'} expNegY = exp(-z.y);
      ${wgsl ? 'let' : 'float'} coshY = 0.5 * (expY + expNegY);
      ${wgsl ? 'let' : 'float'} sinhY = 0.5 * (expY - expNegY);
      return ${type}(sin(z.x) * coshY, cos(z.x) * sinhY);
    }`);
  if (uses('complexCos')) functions.push(`
    ${declaration('complexCos', ['z'])} {
      ${wgsl ? 'let' : 'float'} expY = exp(z.y);
      ${wgsl ? 'let' : 'float'} expNegY = exp(-z.y);
      ${wgsl ? 'let' : 'float'} coshY = 0.5 * (expY + expNegY);
      ${wgsl ? 'let' : 'float'} sinhY = 0.5 * (expY - expNegY);
      return ${type}(cos(z.x) * coshY, -sin(z.x) * sinhY);
    }`);
  if (uses('complexSqrt')) functions.push(`
    ${declaration('complexSqrt', ['z'])} {
      ${wgsl ? 'let' : 'float'} radius = sqrt(length(z));
      ${wgsl ? 'let' : 'float'} halfAngle = 0.5 * (${angle});
      return radius * ${type}(cos(halfAngle), sin(halfAngle));
    }`);
  return functions.join('\n');
}

function webGpuComplexFieldShaderSource(shader) {
  const magnitudeSpan = shaderFloat(Math.max(1e-12, shader.magnitudeMax - shader.magnitudeMin));
  return `
    struct RelationUniforms {
      xRow: vec4f, yRow: vec4f, viewport: vec4f, faceColor: vec4f,
      edgeColor: vec4f, selectionColor: vec4f, geometry: vec4f, interaction: vec4f,
    }
    @group(0) @binding(0) var<uniform> uniforms: RelationUniforms;
    struct RelationVertexOutput { @builtin(position) position: vec4f, @location(0) screen: vec2f }
    @vertex fn relationVertex(@builtin(vertex_index) index: u32) -> RelationVertexOutput {
      let positions = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(-1.0, 3.0), vec2f(3.0, -1.0));
      let position = positions[index]; var output: RelationVertexOutput;
      output.position = vec4f(position, 0.0, 1.0);
      output.screen = vec2f((position.x + 1.0) * 0.5 * uniforms.viewport.x, (1.0 - position.y) * 0.5 * uniforms.viewport.y);
      return output;
    }
    ${complexMathFunctions('wgsl', shader.wgslValue)}
    ${scalarColormapFunction(shader, 'wgsl')}
    @fragment fn relationFragment(input: RelationVertexOutput) -> @location(0) vec4f {
      let a = uniforms.xRow.x; let c = uniforms.xRow.y; let e = uniforms.xRow.z;
      let b = uniforms.yRow.x; let d = uniforms.yRow.y; let f = uniforms.yRow.z;
      let translated = input.screen - vec2f(e, f); let determinant = a * d - b * c;
      let local = vec2f((d * translated.x - c * translated.y) / determinant, (-b * translated.x + a * translated.y) / determinant);
      let x = local.x; let y = local.y; let t = uniforms.interaction.z;
      let value = ${shader.wgslValue};
      let phase = atan2(value.y, value.x);
      let phaseUnit = fract((phase + 6.283185307179586) / 6.283185307179586);
      let alpha = clamp((length(value) - ${shaderFloat(shader.magnitudeMin)}) / ${magnitudeSpan}, 0.0, 1.0);
      let color = textureColor(phaseUnit);
      return vec4f(color.rgb, color.a * alpha);
    }
    @fragment fn relationPickFragment() -> @location(0) u32 { return 1u; }
  `;
}

function webGlComplexFieldFragmentSource(shader) {
  const magnitudeSpan = shaderFloat(Math.max(1e-12, shader.magnitudeMax - shader.magnitudeMin));
  return `#version 300 es
    precision highp float; in vec2 v_screen; uniform mat3 u_transform; uniform float u_time;
    out vec4 out_color;
    ${complexMathFunctions('glsl', shader.glslValue)}
    ${scalarColormapFunction(shader, 'glsl')}
    void main() {
      float a = u_transform[0][0]; float b = u_transform[0][1];
      float c = u_transform[1][0]; float d = u_transform[1][1];
      float e = u_transform[2][0]; float f = u_transform[2][1];
      vec2 translated = v_screen - vec2(e, f); float determinant = a * d - b * c;
      vec2 local = vec2((d * translated.x - c * translated.y) / determinant, (-b * translated.x + a * translated.y) / determinant);
      float x = local.x; float y = local.y; float t = u_time;
      vec2 value = ${shader.glslValue};
      if (any(isnan(value)) || any(isinf(value))) discard;
      float phase = atan(value.y, value.x);
      float phase_unit = fract((phase + 6.283185307179586) / 6.283185307179586);
      float alpha = clamp((length(value) - ${shaderFloat(shader.magnitudeMin)}) / ${magnitudeSpan}, 0.0, 1.0);
      vec4 color = texture_color(phase_unit);
      out_color = vec4(color.rgb, color.a * alpha);
    }
  `;
}

function webGpuScalarFieldShaderSource(shader) {
  const domain = shaderFloat(Math.max(1e-12, shader.valueMax - shader.valueMin));
  const normalize = shader.colorScaleMode === 'cyclic'
    ? `fract((value - ${shaderFloat(shader.valueMin)}) / ${domain})`
    : `clamp((value - ${shaderFloat(shader.valueMin)}) / ${domain}, 0.0, 1.0)`;
  return `
    struct RelationUniforms {
      xRow: vec4f, yRow: vec4f, viewport: vec4f, faceColor: vec4f,
      edgeColor: vec4f, selectionColor: vec4f, geometry: vec4f, interaction: vec4f,
    }
    @group(0) @binding(0) var<uniform> uniforms: RelationUniforms;
    struct RelationVertexOutput { @builtin(position) position: vec4f, @location(0) screen: vec2f }
    @vertex fn relationVertex(@builtin(vertex_index) index: u32) -> RelationVertexOutput {
      let positions = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(-1.0, 3.0), vec2f(3.0, -1.0));
      let position = positions[index]; var output: RelationVertexOutput;
      output.position = vec4f(position, 0.0, 1.0);
      output.screen = vec2f((position.x + 1.0) * 0.5 * uniforms.viewport.x, (1.0 - position.y) * 0.5 * uniforms.viewport.y);
      return output;
    }
    ${scalarColormapFunction(shader, 'wgsl')}
    @fragment fn relationFragment(input: RelationVertexOutput) -> @location(0) vec4f {
      let a = uniforms.xRow.x; let c = uniforms.xRow.y; let e = uniforms.xRow.z;
      let b = uniforms.yRow.x; let d = uniforms.yRow.y; let f = uniforms.yRow.z;
      let translated = input.screen - vec2f(e, f); let determinant = a * d - b * c;
      let local = vec2f((d * translated.x - c * translated.y) / determinant, (-b * translated.x + a * translated.y) / determinant);
      let x = local.x; let y = local.y; let t = uniforms.interaction.z;
      let value = ${shader.wgslValue}; let unit = ${normalize};
      return textureColor(unit);
    }
    @fragment fn relationPickFragment() -> @location(0) u32 { return 1u; }
  `;
}

function webGlScalarFieldFragmentSource(shader) {
  const domain = shaderFloat(Math.max(1e-12, shader.valueMax - shader.valueMin));
  const normalize = shader.colorScaleMode === 'cyclic'
    ? `fract((value - ${shaderFloat(shader.valueMin)}) / ${domain})`
    : `clamp((value - ${shaderFloat(shader.valueMin)}) / ${domain}, 0.0, 1.0)`;
  return `#version 300 es
    precision highp float; in vec2 v_screen; uniform mat3 u_transform; uniform float u_time;
    out vec4 out_color; ${scalarColormapFunction(shader, 'glsl')}
    void main() {
      float a = u_transform[0][0]; float b = u_transform[0][1];
      float c = u_transform[1][0]; float d = u_transform[1][1];
      float e = u_transform[2][0]; float f = u_transform[2][1];
      vec2 translated = v_screen - vec2(e, f); float determinant = a * d - b * c;
      vec2 local = vec2((d * translated.x - c * translated.y) / determinant, (-b * translated.x + a * translated.y) / determinant);
      float x = local.x; float y = local.y; float t = u_time;
      float value = ${shader.glslValue}; float unit = ${normalize};
      out_color = texture_color(unit);
    }
  `;
}

function webGlScalarFieldPickFragmentSource() {
  return `#version 300 es
    precision highp float; out vec4 out_color;
    void main() { out_color = vec4(1.0 / 255.0, 0.0, 0.0, 0.0); }
  `;
}

function webGlFragmentSource(withColor) {
  return `#version 300 es
    precision mediump float;
    ${withColor ? 'in vec4 v_color;' : ''}
    out vec4 out_color;
    void main() {
      out_color = ${withColor ? 'v_color' : 'vec4(0.0)'};
    }
  `;
}

function webGlSolidFragmentSource() {
  return `#version 300 es
    precision mediump float;
    uniform vec4 u_color;
    out vec4 out_color;
    void main() {
      out_color = u_color;
    }
  `;
}

export function webGlStrokeVertexSource() {
  return `#version 300 es
    in vec2 a_previous_position;
    in vec2 a_from_position;
    in vec4 a_from_color;
    in vec2 a_to_position;
    in vec4 a_to_color;
    in vec2 a_next_position;
    in float a_stroke_scale;
    uniform mat3 u_transform;
    uniform vec2 u_viewport;
    uniform float u_width;
    uniform float u_offset;
    uniform float u_inner_half_width;
    uniform float u_override;
    uniform vec4 u_override_color;
    out vec4 v_color;
    out vec2 v_screen_position;
    out float v_half_width;
    flat out vec2 v_previous_screen;
    flat out vec2 v_from_screen;
    flat out vec2 v_to_screen;
    flat out vec2 v_next_screen;
    void main() {
      float along = (gl_VertexID == 0 || gl_VertexID == 1 || gl_VertexID == 3) ? 0.0 : 1.0;
      float side = (gl_VertexID == 0 || gl_VertexID == 3 || gl_VertexID == 5) ? 1.0 : -1.0;
      vec2 from_screen = (u_transform * vec3(a_from_position, 1.0)).xy;
      vec2 to_screen = (u_transform * vec3(a_to_position, 1.0)).xy;
      vec2 previous_screen = (u_transform * vec3(a_previous_position, 1.0)).xy;
      vec2 next_screen = (u_transform * vec3(a_next_position, 1.0)).xy;
      float half_width = u_width * a_stroke_scale * 0.5;
      float outer_radius = half_width + 1.0;
      vec2 segment = to_screen - from_screen;
      vec2 direction = segment / max(length(segment), 0.0001);
      vec2 normal = vec2(-direction.y, direction.x);
      vec2 center = mix(from_screen - direction * outer_radius, to_screen + direction * outer_radius, along);
      vec2 screen = center + normal * (side * outer_radius + u_offset);
      gl_Position = vec4(screen.x / u_viewport.x * 2.0 - 1.0, 1.0 - screen.y / u_viewport.y * 2.0, 0.0, 1.0);
      v_color = u_override > 0.5 ? u_override_color : mix(a_from_color, a_to_color, along);
      v_screen_position = screen;
      v_half_width = half_width;
      v_previous_screen = previous_screen;
      v_from_screen = from_screen;
      v_to_screen = to_screen;
      v_next_screen = next_screen;
    }
  `;
}

export function webGlStrokeFragmentSource() {
  return `#version 300 es
    precision highp float;
    in vec4 v_color;
    in vec2 v_screen_position;
    in float v_half_width;
    flat in vec2 v_previous_screen;
    flat in vec2 v_from_screen;
    flat in vec2 v_to_screen;
    flat in vec2 v_next_screen;
    uniform float u_inner_half_width;
    out vec4 out_color;
    float distance_to_segment(vec2 point, vec2 from_point, vec2 to_point) {
      vec2 segment = to_point - from_point;
      float length_squared = dot(segment, segment);
      float along = clamp(dot(point - from_point, segment) / max(length_squared, 0.000001), 0.0, 1.0);
      return length(point - (from_point + segment * along));
    }
    void main() {
      float distance_value = distance_to_segment(v_screen_position, v_from_screen, v_to_screen);
      float antialias = max(fwidth(distance_value), 0.0001);
      float outer_coverage = 1.0 - smoothstep(
        v_half_width,
        v_half_width + antialias,
        distance_value
      );
      float inner_coverage = u_inner_half_width > 0.0
        ? smoothstep(
            u_inner_half_width - antialias,
            u_inner_half_width + antialias,
            distance_value
          )
        : 1.0;
      float coverage = outer_coverage * inner_coverage;
      out_color = vec4(v_color.rgb, v_color.a * coverage);
    }
  `;
}

export function webGlSelectionMaskFragmentSource() {
  return `#version 300 es
    precision highp float;
    in vec2 v_screen_position;
    in float v_half_width;
    flat in vec2 v_from_screen;
    flat in vec2 v_to_screen;
    uniform float u_inner_half_width;
    out vec4 out_color;
    float distance_to_segment(vec2 point, vec2 from_point, vec2 to_point) {
      vec2 segment = to_point - from_point;
      float length_squared = dot(segment, segment);
      float along = clamp(dot(point - from_point, segment) / max(length_squared, 0.000001), 0.0, 1.0);
      return length(point - (from_point + segment * along));
    }
    void main() {
      float distance_value = distance_to_segment(v_screen_position, v_from_screen, v_to_screen);
      float antialias = max(fwidth(distance_value), 0.0001);
      float outer_coverage = 1.0 - smoothstep(
        v_half_width,
        v_half_width + antialias,
        distance_value
      );
      float inner_coverage = 1.0 - smoothstep(
        u_inner_half_width,
        u_inner_half_width + antialias,
        distance_value
      );
      out_color = vec4(outer_coverage, inner_coverage, 0.0, 0.0);
    }
  `;
}

export function webGlSelectionCompositeVertexSource() {
  return `#version 300 es
    out vec2 v_uv;
    void main() {
      vec2 positions[3] = vec2[3](
        vec2(-1.0, -1.0),
        vec2(3.0, -1.0),
        vec2(-1.0, 3.0)
      );
      vec2 position = positions[gl_VertexID];
      gl_Position = vec4(position, 0.0, 1.0);
      v_uv = position * 0.5 + 0.5;
    }
  `;
}

export function webGlSelectionCompositeFragmentSource() {
  return `#version 300 es
    precision highp float;
    in vec2 v_uv;
    uniform sampler2D u_selection_mask;
    uniform vec4 u_selection_color;
    out vec4 out_color;
    void main() {
      vec2 mask = texelFetch(u_selection_mask, ivec2(gl_FragCoord.xy), 0).rg;
      float ring_coverage = mask.r * (1.0 - mask.g);
      out_color = vec4(u_selection_color.rgb, u_selection_color.a * ring_coverage);
    }
  `;
}

function webGlPickVertexSource() {
  return `#version 300 es
    in vec2 a_from_position;
    in vec2 a_to_position;
    in float a_stroke_scale;
    uniform mat3 u_transform;
    uniform vec2 u_viewport;
    uniform float u_width;
    uniform uint u_pick_base;
    flat out uint v_pick_id;
    void main() {
      float along = (gl_VertexID == 0 || gl_VertexID == 1 || gl_VertexID == 3) ? 0.0 : 1.0;
      float side = (gl_VertexID == 0 || gl_VertexID == 3 || gl_VertexID == 5) ? 1.0 : -1.0;
      vec2 from_screen = (u_transform * vec3(a_from_position, 1.0)).xy;
      vec2 to_screen = (u_transform * vec3(a_to_position, 1.0)).xy;
      vec2 delta = to_screen - from_screen;
      vec2 normal = vec2(-delta.y, delta.x) / max(length(delta), 0.0001);
      vec2 screen = mix(from_screen, to_screen, along) + normal * side * u_width * a_stroke_scale * 0.5;
      gl_Position = vec4(screen.x / u_viewport.x * 2.0 - 1.0, 1.0 - screen.y / u_viewport.y * 2.0, 0.0, 1.0);
      v_pick_id = u_pick_base + uint(gl_InstanceID + 1);
    }
  `;
}

function webGlFacePickVertexSource() {
  return `#version 300 es
    in vec2 a_position;
    uniform mat3 u_transform;
    uniform vec2 u_viewport;
    flat out uint v_pick_id;
    void main() {
      vec2 screen = (u_transform * vec3(a_position, 1.0)).xy;
      gl_Position = vec4(
        screen.x / u_viewport.x * 2.0 - 1.0,
        1.0 - screen.y / u_viewport.y * 2.0,
        0.0,
        1.0
      );
      v_pick_id = uint(gl_VertexID / 3 + 1);
    }
  `;
}

function webGlPickFragmentSource() {
  return `#version 300 es
    precision highp float;
    precision highp int;
    flat in uint v_pick_id;
    out vec4 out_color;
    void main() {
      out_color = vec4(
        float(v_pick_id & 255u),
        float((v_pick_id >> 8u) & 255u),
        float((v_pick_id >> 16u) & 255u),
        float((v_pick_id >> 24u) & 255u)
      ) / 255.0;
    }
  `;
}

function createWebGlProgram(gl, vertexSource, fragmentSource) {
  const compile = (type, source) => {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const message = gl.getShaderInfoLog(shader) || 'WebGL shader compilation failed';
      gl.deleteShader(shader);
      throw new Error(message);
    }
    return shader;
  };
  const vertex = compile(gl.VERTEX_SHADER, vertexSource);
  const fragment = compile(gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program) || 'WebGL program linking failed';
    gl.deleteProgram(program);
    throw new Error(message);
  }
  return program;
}
