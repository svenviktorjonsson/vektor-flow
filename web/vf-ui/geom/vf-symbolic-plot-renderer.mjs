const FLOATS_PER_VERTEX = 6;
const BYTES_PER_VERTEX = FLOATS_PER_VERTEX * Float32Array.BYTES_PER_ELEMENT;
const DEFAULT_TRANSFORM = Object.freeze([1, 0, 0, 1, 0, 0]);
const FLOATS_PER_SEGMENT = 12;

export const SYMBOLIC_PLOT_EDGE_WIDTH = 2;
export const SYMBOLIC_PLOT_SELECTION_GAP = 4;
export const SYMBOLIC_PLOT_SELECTION_WIDTH = 2;
export const SYMBOLIC_PLOT_SELECTION_COLOR = Object.freeze([120 / 255, 183 / 255, 211 / 255]);

export const SYMBOLIC_PLOT_VERTEX_STRIDE = BYTES_PER_VERTEX;

export function normalizeSymbolicPlotAppearance(value = {}) {
  const state = ['hovered', 'selected'].includes(value.state) ? value.state : 'normal';
  const alpha = state === 'selected' ? 0.75 : state === 'hovered' ? 0.5 : 0;
  return Object.freeze({
    state,
    edgeWidth: positive(value.edgeWidth, SYMBOLIC_PLOT_EDGE_WIDTH),
    selectionGap: nonNegative(value.selectionGap, SYMBOLIC_PLOT_SELECTION_GAP),
    selectionWidth: positive(value.selectionWidth, SYMBOLIC_PLOT_SELECTION_WIDTH),
    selectionColor: Object.freeze(normalizeRgb(value.selectionColor, SYMBOLIC_PLOT_SELECTION_COLOR)),
    selectionAlpha: alpha
  });
}

export function packSymbolicPlotSegments(arena) {
  if (!arena?.data || !(arena.data instanceof Float32Array)) return new Float32Array();
  const packed = [];
  const append = (from, to) => {
    const fromOffset = from * FLOATS_PER_VERTEX;
    const toOffset = to * FLOATS_PER_VERTEX;
    for (let index = 0; index < FLOATS_PER_VERTEX; index += 1) packed.push(arena.data[fromOffset + index]);
    for (let index = 0; index < FLOATS_PER_VERTEX; index += 1) packed.push(arena.data[toOffset + index]);
  };
  for (const range of arena.ranges || []) {
    if (range.topology === 'line-list') {
      for (let index = 0; index + 1 < range.count; index += 2) append(range.first + index, range.first + index + 1);
    } else if (range.topology === 'line-strip') {
      for (let index = 0; index + 1 < range.count; index += 1) append(range.first + index, range.first + index + 1);
    }
  }
  return new Float32Array(packed);
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
  return Object.freeze({
    ...resolved,
    segments,
    segmentCount: segments.length / FLOATS_PER_SEGMENT
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

export function createSymbolicPlotRenderer(canvas, options = {}) {
  if (!canvas?.getContext) throw new TypeError('canvas must provide getContext');
  const pixelRatio = options.pixelRatio || (() => globalThis.devicePixelRatio || 1);
  const backendFactory = options.backendFactory || createDefaultBackend;
  let backend = null;
  let arena = null;
  let transform = [...DEFAULT_TRANSFORM];
  let clipTriangles = new Float32Array();
  let cssWidth = 1;
  let cssHeight = 1;
  let uploadedData = null;
  let uploadedRevision = Symbol('not-uploaded');
  let appearance = normalizeSymbolicPlotAppearance();
  let destroyed = false;

  async function initialize() {
    assertAlive();
    resize();
    backend = await backendFactory(canvas, options);
    if (!backend) throw new Error('A WebGPU or WebGL2 GPU backend is required');
    backend.resize(cssWidth, cssHeight);
    backend.updateTransform(transform);
    backend.updateClip(clipTriangles);
    backend.updateAppearance(appearance);
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

  function updateTransform(nextTransform) {
    assertAlive();
    transform = normalizeTransform(nextTransform);
    backend?.updateTransform(transform);
  }

  function updateClip(polygon = null) {
    assertAlive();
    clipTriangles = polygon == null
      ? new Float32Array()
      : triangulateSymbolicPlotClip(polygon);
    backend?.updateClip(clipTriangles);
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
    if (!arena) {
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

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    backend?.destroy();
    backend = null;
    arena = null;
    uploadedData = null;
    clipTriangles = new Float32Array();
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
    resize,
    render,
    destroy,
    get backend() {
      return backend?.kind || null;
    }
  });
}

function positive(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
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
    return Object.freeze({ mode, topology, first, count: rangeCount });
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
  const adapter = await globalThis.navigator.gpu.requestAdapter();
  if (!adapter) return null;
  const device = await adapter.requestDevice();
  const context = canvas.getContext('webgpu');
  if (!context) return null;
  const format = globalThis.navigator.gpu.getPreferredCanvasFormat();
  const shader = device.createShaderModule({ code: webGpuShaderSource() });
  const transformBuffer = device.createBuffer({
    size: 48,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
  });
  const strokeBuffers = Array.from({ length: 3 }, () => device.createBuffer({
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
  const clipVertexLayout = {
    arrayStride: 8,
    attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }]
  };
  const segmentVertexLayout = {
    arrayStride: FLOATS_PER_SEGMENT * Float32Array.BYTES_PER_ELEMENT,
    stepMode: 'instance',
    attributes: [
      { shaderLocation: 2, offset: 0, format: 'float32x2' },
      { shaderLocation: 3, offset: 8, format: 'float32x4' },
      { shaderLocation: 4, offset: 24, format: 'float32x2' },
      { shaderLocation: 5, offset: 32, format: 'float32x4' }
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

  let plotBuffer = null;
  let plotCapacity = 0;
  let segmentBuffer = null;
  let segmentCapacity = 0;
  let clipBuffer = null;
  let clipCapacity = 0;
  let clipCount = 0;
  let currentArena = null;
  let stencilTexture = null;
  let cssSize = [1, 1];
  let appearance = normalizeSymbolicPlotAppearance();

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
      stencilTexture = device.createTexture({
        size: [canvas.width, canvas.height],
        format: 'depth24plus-stencil8',
        usage: GPUTextureUsage.RENDER_ATTACHMENT
      });
    },
    updateTransform(transform) {
      writeWebGpuTransform(device, transformBuffer, transform, cssSize);
    },
    updateClip(vertices) {
      clipCount = vertices.length / 2;
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
      const clipped = clipCount > 0;
      if (clipped) {
        pass.setPipeline(clipPipeline);
        pass.setBindGroup(0, bindGroups[0]);
        pass.setStencilReference(1);
        pass.setVertexBuffer(0, clipBuffer);
        pass.draw(clipCount);
      }
      if (plotBuffer && currentArena) {
        pass.setBindGroup(0, bindGroups[0]);
        pass.setStencilReference(1);
        pass.setVertexBuffer(0, plotBuffer);
        for (const range of currentArena.ranges) {
          if (!range.count) continue;
          if (range.topology === 'line-list' || range.topology === 'line-strip') continue;
          pass.setPipeline(pipelines.get(`${range.topology}:${clipped}`));
          pass.draw(range.count, 1, range.first);
        }
      }
      if (segmentBuffer && currentArena?.segmentCount) {
        pass.setPipeline(strokePipelines.get(clipped));
        pass.setStencilReference(1);
        pass.setVertexBuffer(0, segmentBuffer);
        if (appearance.selectionAlpha > 0) {
          pass.setBindGroup(0, bindGroups[1]);
          pass.draw(6, currentArena.segmentCount);
          pass.setBindGroup(0, bindGroups[2]);
          pass.draw(6, currentArena.segmentCount);
        }
        pass.setBindGroup(0, bindGroups[0]);
        pass.draw(6, currentArena.segmentCount);
      }
      pass.end();
      device.queue.submit([encoder.finish()]);
    },
    destroy() {
      plotBuffer?.destroy();
      clipBuffer?.destroy();
      segmentBuffer?.destroy();
      stencilTexture?.destroy();
      transformBuffer.destroy();
      strokeBuffers.forEach((buffer) => buffer.destroy());
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
  const offset = appearance.edgeWidth / 2 + appearance.selectionGap + appearance.selectionWidth / 2;
  const write = (buffer, width, strokeOffset, color, alpha, override) => {
    device.queue.writeBuffer(buffer, 0, new Float32Array([
      width, strokeOffset, override ? 1 : 0, 0,
      color[0], color[1], color[2], alpha
    ]));
  };
  write(buffers[0], appearance.edgeWidth, 0, [0, 0, 0], 0, false);
  write(buffers[1], appearance.selectionWidth, -offset, appearance.selectionColor, appearance.selectionAlpha, true);
  write(buffers[2], appearance.selectionWidth, offset, appearance.selectionColor, appearance.selectionAlpha, true);
}

function webGpuShaderSource() {
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
    struct StrokeInput {
      @location(2) fromPosition: vec2f,
      @location(3) fromColor: vec4f,
      @location(4) toPosition: vec2f,
      @location(5) toColor: vec4f,
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

    @vertex fn strokeVertex(input: StrokeInput, @builtin(vertex_index) vertexIndex: u32) -> PlotOutput {
      let along = select(1.0, 0.0, vertexIndex == 0u || vertexIndex == 1u || vertexIndex == 3u);
      let side = select(-1.0, 1.0, vertexIndex == 0u || vertexIndex == 3u || vertexIndex == 5u);
      let fromScreen = vec2f(dot(view.xRow.xyz, vec3f(input.fromPosition, 1.0)), dot(view.yRow.xyz, vec3f(input.fromPosition, 1.0)));
      let toScreen = vec2f(dot(view.xRow.xyz, vec3f(input.toPosition, 1.0)), dot(view.yRow.xyz, vec3f(input.toPosition, 1.0)));
      let delta = toScreen - fromScreen;
      let normal = vec2f(-delta.y, delta.x) / max(length(delta), 0.0001);
      let screen = mix(fromScreen, toScreen, along) + normal * (stroke.geometry.y + side * stroke.geometry.x * 0.5);
      var output: PlotOutput;
      output.position = vec4f(screen.x / view.viewport.x * 2.0 - 1.0, 1.0 - screen.y / view.viewport.y * 2.0, 0.0, 1.0);
      output.color = select(mix(input.fromColor, input.toColor, along), stroke.color, stroke.geometry.z > 0.5);
      return output;
    }

    @fragment fn plotFragment(input: PlotOutput) -> @location(0) vec4f {
      return input.color;
    }

    @vertex fn clipVertex(@location(0) position: vec2f) -> @builtin(position) vec4f {
      return project(position);
    }

    @fragment fn clipFragment() -> @location(0) vec4f {
      return vec4f(0.0);
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
  const clipProgram = createWebGlProgram(gl, webGlVertexSource(false), webGlFragmentSource(false));
  const strokeProgram = createWebGlProgram(gl, webGlStrokeVertexSource(), webGlFragmentSource(true));
  const plotBuffer = gl.createBuffer();
  const clipBuffer = gl.createBuffer();
  const segmentBuffer = gl.createBuffer();
  const plotLocations = getWebGlLocations(gl, plotProgram, true);
  const clipLocations = getWebGlLocations(gl, clipProgram, false);
  const strokeLocations = getWebGlStrokeLocations(gl, strokeProgram);
  let plotCapacity = 0;
  let clipCapacity = 0;
  let clipCount = 0;
  let currentArena = null;
  let appearance = normalizeSymbolicPlotAppearance();
  let transform = [...DEFAULT_TRANSFORM];
  let cssSize = [1, 1];

  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

  return {
    kind: 'webgl2',
    resize(width, height) {
      cssSize = [width, height];
      gl.viewport(0, 0, canvas.width, canvas.height);
    },
    updateTransform(nextTransform) {
      transform = [...nextTransform];
    },
    updateClip(vertices) {
      clipCount = vertices.length / 2;
      gl.bindBuffer(gl.ARRAY_BUFFER, clipBuffer);
      if (vertices.byteLength > clipCapacity) {
        clipCapacity = growSymbolicPlotCapacity(clipCapacity, vertices.byteLength);
        gl.bufferData(gl.ARRAY_BUFFER, clipCapacity, gl.DYNAMIC_DRAW);
      }
      if (vertices.byteLength) gl.bufferSubData(gl.ARRAY_BUFFER, 0, vertices);
    },
    updateAppearance(nextAppearance) {
      appearance = nextAppearance;
    },
    render(arena, upload) {
      currentArena = arena;
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clearStencil(0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
      if (!currentArena) return;
      if (upload) {
        gl.bindBuffer(gl.ARRAY_BUFFER, plotBuffer);
        if (currentArena.data.byteLength > plotCapacity) {
          plotCapacity = growSymbolicPlotCapacity(plotCapacity, currentArena.data.byteLength);
          gl.bufferData(gl.ARRAY_BUFFER, plotCapacity, gl.DYNAMIC_DRAW);
        }
        if (currentArena.data.byteLength) {
          gl.bufferSubData(gl.ARRAY_BUFFER, 0, currentArena.data);
        }
        gl.bindBuffer(gl.ARRAY_BUFFER, segmentBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, currentArena.segments, gl.DYNAMIC_DRAW);
      }

      const clipped = clipCount > 0;
      if (clipped) drawWebGlClip(gl, clipProgram, clipBuffer, clipLocations, transform, cssSize, clipCount);
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
    destroy() {
      gl.deleteBuffer(plotBuffer);
      gl.deleteBuffer(clipBuffer);
      gl.deleteBuffer(segmentBuffer);
      gl.deleteProgram(plotProgram);
      gl.deleteProgram(clipProgram);
      gl.deleteProgram(strokeProgram);
    }
  };
}

function drawWebGlClip(gl, program, buffer, locations, transform, size, count) {
  gl.enable(gl.STENCIL_TEST);
  gl.stencilMask(0xff);
  gl.stencilFunc(gl.ALWAYS, 1, 0xff);
  gl.stencilOp(gl.KEEP, gl.KEEP, gl.REPLACE);
  gl.colorMask(false, false, false, false);
  gl.useProgram(program);
  setWebGlView(gl, locations, transform, size);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.enableVertexAttribArray(locations.position);
  gl.vertexAttribPointer(locations.position, 2, gl.FLOAT, false, 8, 0);
  gl.drawArrays(gl.TRIANGLES, 0, count);
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
    if (range.topology === 'line-list' || range.topology === 'line-strip') continue;
    gl.drawArrays(webGlTopology(gl, range.topology), range.first, range.count);
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
    [locations.fromPosition, 2, 0],
    [locations.fromColor, 4, 8],
    [locations.toPosition, 2, 24],
    [locations.toColor, 4, 32]
  ];
  for (const [location, sizeValue, offset] of attributes) {
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, sizeValue, gl.FLOAT, false, FLOATS_PER_SEGMENT * 4, offset);
    gl.vertexAttribDivisor(location, 1);
  }
  const draw = (width, offset, color, alpha, override) => {
    gl.uniform1f(locations.width, width);
    gl.uniform1f(locations.offset, offset);
    gl.uniform1f(locations.override, override ? 1 : 0);
    gl.uniform4f(locations.overrideColor, color[0], color[1], color[2], alpha);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, count);
  };
  if (appearance.selectionAlpha > 0) {
    const offset = appearance.edgeWidth / 2 + appearance.selectionGap + appearance.selectionWidth / 2;
    draw(appearance.selectionWidth, -offset, appearance.selectionColor, appearance.selectionAlpha, true);
    draw(appearance.selectionWidth, offset, appearance.selectionColor, appearance.selectionAlpha, true);
  }
  draw(appearance.edgeWidth, 0, [0, 0, 0], 0, false);
  for (const [location] of attributes) gl.vertexAttribDivisor(location, 0);
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
    fromPosition: gl.getAttribLocation(program, 'a_from_position'),
    fromColor: gl.getAttribLocation(program, 'a_from_color'),
    toPosition: gl.getAttribLocation(program, 'a_to_position'),
    toColor: gl.getAttribLocation(program, 'a_to_color'),
    transform: gl.getUniformLocation(program, 'u_transform'),
    viewport: gl.getUniformLocation(program, 'u_viewport'),
    width: gl.getUniformLocation(program, 'u_width'),
    offset: gl.getUniformLocation(program, 'u_offset'),
    override: gl.getUniformLocation(program, 'u_override'),
    overrideColor: gl.getUniformLocation(program, 'u_override_color')
  };
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

function webGlStrokeVertexSource() {
  return `#version 300 es
    in vec2 a_from_position;
    in vec4 a_from_color;
    in vec2 a_to_position;
    in vec4 a_to_color;
    uniform mat3 u_transform;
    uniform vec2 u_viewport;
    uniform float u_width;
    uniform float u_offset;
    uniform float u_override;
    uniform vec4 u_override_color;
    out vec4 v_color;
    void main() {
      float along = (gl_VertexID == 0 || gl_VertexID == 1 || gl_VertexID == 3) ? 0.0 : 1.0;
      float side = (gl_VertexID == 0 || gl_VertexID == 3 || gl_VertexID == 5) ? 1.0 : -1.0;
      vec2 from_screen = (u_transform * vec3(a_from_position, 1.0)).xy;
      vec2 to_screen = (u_transform * vec3(a_to_position, 1.0)).xy;
      vec2 delta = to_screen - from_screen;
      float length_value = max(length(delta), 0.0001);
      vec2 normal = vec2(-delta.y, delta.x) / length_value;
      vec2 screen = mix(from_screen, to_screen, along) + normal * (u_offset + side * u_width * 0.5);
      gl_Position = vec4(screen.x / u_viewport.x * 2.0 - 1.0, 1.0 - screen.y / u_viewport.y * 2.0, 0.0, 1.0);
      v_color = u_override > 0.5 ? u_override_color : mix(a_from_color, a_to_color, along);
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
