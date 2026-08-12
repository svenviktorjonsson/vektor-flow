import { createWebGpuProbeCanvas } from './vf-gpu-backend-probe.mjs';

const FLOATS_PER_VERTEX = 6;
const BYTES_PER_VERTEX = FLOATS_PER_VERTEX * Float32Array.BYTES_PER_ELEMENT;
const DEFAULT_COLOR = Object.freeze([1, 1, 1, 1]);

export function growPackedVertexCapacity(currentBytes, requiredBytes) {
  let capacity = Math.max(0, Number(currentBytes) || 0);
  const required = Math.max(0, Number(requiredBytes) || 0);
  if (required <= capacity) return capacity;
  capacity = Math.max(256, capacity);
  while (capacity < required) capacity *= 2;
  return Math.ceil(capacity / 4) * 4;
}

export function colorToRgba(color) {
  if (Array.isArray(color) || ArrayBuffer.isView(color)) {
    return [
      clampUnit(Number(color[0])),
      clampUnit(Number(color[1])),
      clampUnit(Number(color[2])),
      clampUnit(color[3] == null ? 1 : Number(color[3]))
    ];
  }
  const value = String(color || '').trim().toLowerCase();
  if (value === 'transparent') return [0, 0, 0, 0];
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(value);
  if (hex) {
    let digits = hex[1];
    if (digits.length === 3) digits = digits.split('').map((digit) => `${digit}${digit}`).join('');
    const alpha = digits.length === 8 ? Number.parseInt(digits.slice(6, 8), 16) / 255 : 1;
    return [
      Number.parseInt(digits.slice(0, 2), 16) / 255,
      Number.parseInt(digits.slice(2, 4), 16) / 255,
      Number.parseInt(digits.slice(4, 6), 16) / 255,
      alpha
    ];
  }
  const rgba = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/.exec(value);
  if (rgba) {
    return [
      clampUnit(Number(rgba[1]) / 255),
      clampUnit(Number(rgba[2]) / 255),
      clampUnit(Number(rgba[3]) / 255),
      clampUnit(rgba[4] == null ? 1 : Number(rgba[4]))
    ];
  }
  return [...DEFAULT_COLOR];
}

export function buildScreenSpaceSimplexVertices(scene = {}) {
  const packed = [];
  for (const primitive of Array.isArray(scene.primitives) ? scene.primitives : []) {
    if (primitive?.kind === 'face') appendFace(packed, primitive);
    if (primitive?.kind === 'edge') appendEdge(packed, primitive);
    if (primitive?.kind === 'vertex') appendVertex(packed, primitive);
  }
  return new Float32Array(packed);
}

export function createRetainedScreenSpaceSimplexScene() {
  const records = new Map();
  let packed = new Float32Array();
  let dirty = false;
  let invalidated = false;

  function upsert(id, primitive) {
    const key = String(id);
    const current = records.get(key);
    if (current?.primitive === primitive) return false;
    const nextPacked = buildScreenSpaceSimplexVertices({ primitives: [primitive] });
    if (current && equalPackedVertices(current.packed, nextPacked)) {
      records.set(key, { primitive, packed: current.packed });
      return false;
    }
    records.set(key, { primitive, packed: nextPacked });
    dirty = true;
    return true;
  }

  function remove(id) {
    const changed = records.delete(String(id));
    dirty ||= changed;
    return changed;
  }

  function replace(nextRecords = []) {
    const next = new Map();
    for (const [id, primitive] of nextRecords) {
      const key = String(id);
      const current = records.get(key);
      if (current?.primitive === primitive) {
        next.set(key, current);
        continue;
      }
      const nextPacked = buildScreenSpaceSimplexVertices({ primitives: [primitive] });
      if (current && equalPackedVertices(current.packed, nextPacked)) {
        next.set(key, { primitive, packed: current.packed });
        continue;
      }
      next.set(key, { primitive, packed: nextPacked });
      dirty = true;
    }
    const previousKeys = [...records.keys()];
    const nextKeys = [...next.keys()];
    if (previousKeys.length !== nextKeys.length
      || previousKeys.some((key, index) => key !== nextKeys[index])) {
      dirty = true;
    }
    records.clear();
    for (const [key, record] of next) records.set(key, record);
    return dirty;
  }

  function commit(renderer) {
    if (!dirty) return false;
    const previous = packed;
    const length = [...records.values()].reduce((sum, record) => sum + record.packed.length, 0);
    packed = new Float32Array(length);
    let offset = 0;
    for (const record of records.values()) {
      packed.set(record.packed, offset);
      offset += record.packed.length;
    }
    renderer.setPackedVertices(
      packed,
      invalidated
        ? Object.freeze({ floatOffset: 0, floatLength: packed.length })
        : packedVertexDirtyRange(previous, packed)
    );
    dirty = false;
    invalidated = false;
    return true;
  }

  function invalidate() {
    dirty = true;
    invalidated = true;
  }

  return Object.freeze({
    upsert,
    remove,
    replace,
    commit,
    invalidate,
    get size() {
      return records.size;
    },
    get packedVertices() {
      return packed;
    }
  });
}

function packedVertexDirtyRange(previous, next) {
  if (previous.length !== next.length) {
    return Object.freeze({ floatOffset: 0, floatLength: next.length });
  }
  let start = 0;
  while (start < next.length && previous[start] === next[start]) start += 1;
  let end = next.length;
  while (end > start && previous[end - 1] === next[end - 1]) end -= 1;
  return Object.freeze({ floatOffset: start, floatLength: end - start });
}

function equalPackedVertices(left, right) {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

export function requirePackedSimplexVertices(value) {
  if (!(value instanceof Float32Array)) {
    throw new TypeError('packed simplex vertices must be a Float32Array');
  }
  if (value.length % (FLOATS_PER_VERTEX * 3) !== 0) {
    throw new RangeError('packed simplex vertices must contain complete triangles');
  }
  return value;
}

export function createScreenSpaceSimplexRenderer(canvas, options = {}) {
  if (!canvas?.getContext) throw new TypeError('canvas must provide getContext');
  const pixelRatio = options.pixelRatio || (() => globalThis.devicePixelRatio || 1);
  let backend = null;
  let scene = { primitives: [] };
  let vertices = new Float32Array();
  let cssWidth = 1;
  let cssHeight = 1;
  let destroyed = false;

  async function initialize() {
    assertAlive();
    resize();
    backend = await createWebGpuBackend(canvas).catch(() => null);
    if (!backend) backend = createWebGl2Backend(canvas);
    if (!backend) throw new Error('A WebGPU or WebGL2 GPU backend is required');
    backend.resize(cssWidth, cssHeight);
    backend.render(vertices);
    return backend.kind;
  }

  function setScene(nextScene = {}) {
    assertAlive();
    scene = nextScene;
    vertices = buildScreenSpaceSimplexVertices(scene);
    backend?.render(vertices);
  }

  function setPackedVertices(nextVertices, dirtyRange = null) {
    assertAlive();
    scene = null;
    vertices = requirePackedSimplexVertices(nextVertices);
    backend?.render(vertices, dirtyRange);
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
    backend?.render(vertices);
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    backend?.destroy();
    backend = null;
    vertices = new Float32Array();
    scene = { primitives: [] };
  }

  function assertAlive() {
    if (destroyed) throw new Error('screen-space simplex renderer is destroyed');
  }

  return Object.freeze({
    initialize,
    setScene,
    setPackedVertices,
    resize,
    destroy,
    get backend() {
      return backend?.kind || null;
    }
  });
}

function appendFace(output, primitive) {
  const points = validPoints(primitive.points);
  if (points.length < 3) return;
  const colors = pointColors(primitive.colors, points.length, primitive.color);
  for (let index = 1; index < points.length - 1; index += 1) {
    appendPackedVertex(output, points[0], colors[0]);
    appendPackedVertex(output, points[index], colors[index]);
    appendPackedVertex(output, points[index + 1], colors[index + 1]);
  }
}

function appendEdge(output, primitive) {
  const from = validPoint(primitive.from);
  const to = validPoint(primitive.to);
  const width = Math.max(0, Number(primitive.width) || 0);
  if (!from || !to || width <= 0) return;
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const length = Math.hypot(dx, dy);
  if (length <= 1e-9) return;
  const nx = (-dy / length) * width / 2;
  const ny = (dx / length) * width / 2;
  const a = [from[0] + nx, from[1] + ny];
  const b = [from[0] - nx, from[1] - ny];
  const c = [to[0] - nx, to[1] - ny];
  const d = [to[0] + nx, to[1] + ny];
  const fromColor = colorToRgba(primitive.fromColor ?? primitive.color);
  const toColor = colorToRgba(primitive.toColor ?? primitive.color);
  for (const [point, color] of [
    [a, fromColor], [b, fromColor], [c, toColor],
    [a, fromColor], [c, toColor], [d, toColor]
  ]) appendPackedVertex(output, point, color);
}

function pointColors(colors, count, fallback) {
  if (!Array.isArray(colors) || colors.length !== count) {
    const color = colorToRgba(fallback);
    return Array.from({ length: count }, () => color);
  }
  return colors.map(colorToRgba);
}

function appendVertex(output, primitive) {
  const center = validPoint(primitive.center);
  const radius = Math.max(0, Number(primitive.radius) || 0);
  if (!center || radius <= 0) return;
  const segments = Math.max(6, Math.min(64, Math.round(Number(primitive.segments) || 16)));
  const color = colorToRgba(primitive.color);
  for (let index = 0; index < segments; index += 1) {
    const start = index / segments * Math.PI * 2;
    const end = (index + 1) / segments * Math.PI * 2;
    appendPackedVertex(output, center, color);
    appendPackedVertex(output, [
      center[0] + Math.cos(start) * radius,
      center[1] + Math.sin(start) * radius
    ], color);
    appendPackedVertex(output, [
      center[0] + Math.cos(end) * radius,
      center[1] + Math.sin(end) * radius
    ], color);
  }
}

function appendPackedVertex(output, point, color) {
  output.push(point[0], point[1], color[0], color[1], color[2], color[3]);
}

function validPoints(points) {
  return Array.isArray(points) ? points.map(validPoint).filter(Boolean) : [];
}

function validPoint(point) {
  if (!Array.isArray(point) || point.length < 2) return null;
  const x = Number(point[0]);
  const y = Number(point[1]);
  return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null;
}

function clampUnit(value) {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
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
  const shader = device.createShaderModule({
    code: `
      struct Viewport {
        size: vec2f,
        padding: vec2f,
      }
      @group(0) @binding(0) var<uniform> viewport: Viewport;

      struct VertexInput {
        @location(0) position: vec2f,
        @location(1) color: vec4f,
      }
      struct VertexOutput {
        @builtin(position) position: vec4f,
        @location(0) color: vec4f,
      }

      @vertex fn vertexMain(input: VertexInput) -> VertexOutput {
        var output: VertexOutput;
        output.position = vec4f(
          input.position.x / viewport.size.x * 2.0 - 1.0,
          1.0 - input.position.y / viewport.size.y * 2.0,
          0.0,
          1.0
        );
        output.color = input.color;
        return output;
      }

      @fragment fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
        return input.color;
      }
    `
  });
  const viewportBuffer = device.createBuffer({
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
  });
  const bindGroupLayout = device.createBindGroupLayout({
    entries: [{
      binding: 0,
      visibility: GPUShaderStage.VERTEX,
      buffer: { type: 'uniform' }
    }]
  });
  const pipeline = device.createRenderPipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
    vertex: {
      module: shader,
      entryPoint: 'vertexMain',
      buffers: [{
        arrayStride: BYTES_PER_VERTEX,
        attributes: [
          { shaderLocation: 0, offset: 0, format: 'float32x2' },
          { shaderLocation: 1, offset: 8, format: 'float32x4' }
        ]
      }]
    },
    fragment: {
      module: shader,
      entryPoint: 'fragmentMain',
      targets: [{
        format,
        blend: {
          color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' },
          alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' }
        }
      }]
    },
    primitive: { topology: 'triangle-list' }
  });
  const bindGroup = device.createBindGroup({
    layout: bindGroupLayout,
    entries: [{ binding: 0, resource: { buffer: viewportBuffer } }]
  });
  let vertexBuffer = null;
  let vertexCapacity = 0;
  let vertexCount = 0;

  return {
    kind: 'webgpu',
    resize(width, height) {
      context.configure({ device, format, alphaMode: 'premultiplied' });
      device.queue.writeBuffer(viewportBuffer, 0, new Float32Array([width, height, 0, 0]));
    },
    render(vertices, dirtyRange = null) {
      vertexCount = vertices.length / FLOATS_PER_VERTEX;
      let replacedBuffer = false;
      if (vertices.byteLength > vertexCapacity) {
        vertexBuffer?.destroy();
        vertexCapacity = growPackedVertexCapacity(
          vertexCapacity,
          vertices.byteLength,
        );
        vertexBuffer = device.createBuffer({
          size: vertexCapacity,
          usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
        });
        replacedBuffer = true;
      }
      if (vertices.byteLength) {
        if (!replacedBuffer && dirtyRange && dirtyRange.floatLength < vertices.length) {
          if (dirtyRange.floatLength > 0) {
            device.queue.writeBuffer(
              vertexBuffer,
              dirtyRange.floatOffset * Float32Array.BYTES_PER_ELEMENT,
              vertices,
              dirtyRange.floatOffset,
              dirtyRange.floatLength
            );
          }
        } else {
          device.queue.writeBuffer(vertexBuffer, 0, vertices);
        }
      }
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginRenderPass({
        colorAttachments: [{
          view: context.getCurrentTexture().createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: 'clear',
          storeOp: 'store'
        }]
      });
      if (vertexBuffer && vertexCount) {
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, bindGroup);
        pass.setVertexBuffer(0, vertexBuffer);
        pass.draw(vertexCount);
      }
      pass.end();
      device.queue.submit([encoder.finish()]);
    },
    destroy() {
      vertexBuffer?.destroy();
      viewportBuffer.destroy();
      device.destroy();
    }
  };
}

function createWebGl2Backend(canvas) {
  const gl = canvas.getContext('webgl2', {
    alpha: true,
    antialias: true,
    premultipliedAlpha: true
  });
  if (!gl) return null;
  const program = createWebGlProgram(gl, `#version 300 es
    in vec2 a_position;
    in vec4 a_color;
    uniform vec2 u_viewport;
    out vec4 v_color;
    void main() {
      gl_Position = vec4(
        a_position.x / u_viewport.x * 2.0 - 1.0,
        1.0 - a_position.y / u_viewport.y * 2.0,
        0.0,
        1.0
      );
      v_color = a_color;
    }
  `, `#version 300 es
    precision mediump float;
    in vec4 v_color;
    out vec4 out_color;
    void main() {
      out_color = v_color;
    }
  `);
  const buffer = gl.createBuffer();
  const positionLocation = gl.getAttribLocation(program, 'a_position');
  const colorLocation = gl.getAttribLocation(program, 'a_color');
  const viewportLocation = gl.getUniformLocation(program, 'u_viewport');
  let cssSize = [1, 1];
  let bufferCapacity = 0;

  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

  return {
    kind: 'webgl2',
    resize(width, height) {
      cssSize = [width, height];
      gl.viewport(0, 0, canvas.width, canvas.height);
    },
    render(vertices, dirtyRange = null) {
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      if (!vertices.length) return;
      gl.useProgram(program);
      gl.uniform2f(viewportLocation, cssSize[0], cssSize[1]);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      const replacedBuffer = vertices.byteLength > bufferCapacity;
      if (replacedBuffer) {
        bufferCapacity = growPackedVertexCapacity(
          bufferCapacity,
          vertices.byteLength,
        );
        gl.bufferData(gl.ARRAY_BUFFER, bufferCapacity, gl.DYNAMIC_DRAW);
      }
      if (!replacedBuffer && dirtyRange && dirtyRange.floatLength < vertices.length) {
        if (dirtyRange.floatLength > 0) {
          gl.bufferSubData(
            gl.ARRAY_BUFFER,
            dirtyRange.floatOffset * Float32Array.BYTES_PER_ELEMENT,
            vertices,
            dirtyRange.floatOffset,
            dirtyRange.floatLength
          );
        }
      } else {
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, vertices);
      }
      gl.enableVertexAttribArray(positionLocation);
      gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, BYTES_PER_VERTEX, 0);
      gl.enableVertexAttribArray(colorLocation);
      gl.vertexAttribPointer(colorLocation, 4, gl.FLOAT, false, BYTES_PER_VERTEX, 8);
      gl.drawArrays(gl.TRIANGLES, 0, vertices.length / FLOATS_PER_VERTEX);
    },
    destroy() {
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
    }
  };
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
