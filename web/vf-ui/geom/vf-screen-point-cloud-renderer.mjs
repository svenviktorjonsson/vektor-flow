import {
  RETAINED_POINT_COMPONENTS,
  RETAINED_POINT_DATA,
  RETAINED_POINT_REDRAW,
} from './internal/vf-retained-point-cloud-camera.mjs';

const DEFAULT_COLOR = Object.freeze([0.396, 0.91, 1, 0.92]);

export function projectPointCloud3DToScreen(positions, count, projection, output = null) {
  if (!(positions instanceof Float64Array || positions instanceof Float32Array)) {
    throw new TypeError('point-cloud positions must be a Float32Array or Float64Array');
  }
  const pointCount = Math.max(0, Math.trunc(Number(count) || 0));
  if (positions.length < pointCount * 3) throw new RangeError('point-cloud positions do not cover count');
  const target = output instanceof Float32Array && output.length >= pointCount * 2
    ? output
    : new Float32Array(pointCount * 2);
  const worldOrigin = finiteVector(projection?.worldOrigin, 3, 'worldOrigin');
  const screenOrigin = finiteVector(projection?.screenOrigin, 2, 'screenOrigin');
  const xAxis = finiteVector(projection?.xAxis, 2, 'xAxis');
  const yAxis = finiteVector(projection?.yAxis, 2, 'yAxis');
  const zAxis = finiteVector(projection?.zAxis, 2, 'zAxis');

  for (let index = 0; index < pointCount; index += 1) {
    const source = index * 3;
    const targetOffset = index * 2;
    const x = positions[source] - worldOrigin[0];
    const y = positions[source + 1] - worldOrigin[1];
    const z = positions[source + 2] - worldOrigin[2];
    target[targetOffset] = screenOrigin[0] + x * xAxis[0] + y * yAxis[0] + z * zAxis[0];
    target[targetOffset + 1] = screenOrigin[1] + x * xAxis[1] + y * yAxis[1] + z * zAxis[1];
  }
  return target;
}

export function createScreenSpacePointCloudRenderer(canvas) {
  if (!canvas?.getContext) throw new TypeError('canvas must provide getContext');
  let gl = null;
  let program = null;
  let buffer = null;
  let viewportLocation = null;
  let pointSizeLocation = null;
  let colorLocation = null;
  let worldModeLocation = null;
  let worldOriginLocation = null;
  let screenOriginLocation = null;
  let xAxisLocation = null;
  let yAxisLocation = null;
  let zAxisLocation = null;
  let points = new Float32Array();
  let components = 2;
  let worldMode = false;
  let projection = null;
  let count = 0;
  let pointSize = 4;
  let color = [...DEFAULT_COLOR];
  const projectionScratch = {
    worldOrigin: new Float64Array(3),
    screenOrigin: new Float64Array(2),
    xAxis: new Float64Array(2),
    yAxis: new Float64Array(2),
    zAxis: new Float64Array(2)
  };
  const colorScratch = new Float64Array(4);
  let capacityBytes = 0;
  let pointDataDirty = false;
  let destroyed = false;

  async function initialize() {
    assertAlive();
    gl = canvas.getContext('webgl2', {
      alpha: true,
      antialias: false,
      depth: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false
    });
    if (!gl) throw new Error('WebGL2 is required for point-cloud rendering');
    program = createProgram(gl, VERTEX_SHADER, FRAGMENT_SHADER);
    buffer = gl.createBuffer();
    viewportLocation = gl.getUniformLocation(program, 'u_viewport');
    pointSizeLocation = gl.getUniformLocation(program, 'u_point_size');
    colorLocation = gl.getUniformLocation(program, 'u_color');
    worldModeLocation = gl.getUniformLocation(program, 'u_world_mode');
    worldOriginLocation = gl.getUniformLocation(program, 'u_world_origin');
    screenOriginLocation = gl.getUniformLocation(program, 'u_screen_origin');
    xAxisLocation = gl.getUniformLocation(program, 'u_x_axis');
    yAxisLocation = gl.getUniformLocation(program, 'u_y_axis');
    zAxisLocation = gl.getUniformLocation(program, 'u_z_axis');
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    render();
    return 'webgl2-points';
  }

  function setPoints(nextPoints, options = {}) {
    assertAlive();
    if (!(nextPoints instanceof Float32Array)) throw new TypeError('screen points must be a Float32Array');
    const nextCount = options.count == null ? nextPoints.length / 2 : Number(options.count);
    if (!Number.isInteger(nextCount) || nextCount < 0 || nextPoints.length < nextCount * 2) {
      throw new RangeError('screen point count exceeds the packed buffer');
    }
    pointDataDirty = true;
    points = nextPoints;
    components = 2;
    worldMode = false;
    projection = null;
    count = nextCount;
    pointSize = Math.max(1, Number(options.pointSize ?? pointSize) || 1);
    color = normalizeColor(options.color ?? color);
    render();
  }

  function setWorldPoints(nextPoints, nextProjection, options = {}) {
    assertAlive();
    if (!(nextPoints instanceof Float32Array)) throw new TypeError('world points must be a Float32Array');
    const nextComponents = options[RETAINED_POINT_COMPONENTS] === 2 ? 2 : 3;
    const nextCount = options.count == null ? nextPoints.length / nextComponents : Number(options.count);
    if (!Number.isInteger(nextCount) || nextCount < 0 || nextPoints.length < nextCount * nextComponents) {
      throw new RangeError('world point count exceeds the packed buffer');
    }
    const retainPointData = options[RETAINED_POINT_DATA] === true;
    const nextPointDataDirty = pointDataDirty
      || !retainPointData
      || points !== nextPoints
      || components !== nextComponents
      || !worldMode
      || count !== nextCount;
    const normalizedProjection = normalizeProjection(nextProjection, projection, projectionScratch);
    const nextPointSize = Math.max(1, Number(options.pointSize ?? pointSize) || 1);
    const nextColor = normalizeColor(options.color ?? color, color, colorScratch);
    if (!nextPointDataDirty
      && projection === normalizedProjection
      && pointSize === nextPointSize
      && color === nextColor) {
      return;
    }
    pointDataDirty = nextPointDataDirty;
    points = nextPoints;
    components = nextComponents;
    worldMode = true;
    count = nextCount;
    projection = normalizedProjection;
    pointSize = nextPointSize;
    color = nextColor;
    render();
  }

  function resize(width, height) {
    assertAlive();
    const nextWidth = Math.max(1, Math.round(Number(width) || 1));
    const nextHeight = Math.max(1, Math.round(Number(height) || 1));
    if (canvas.width !== nextWidth) canvas.width = nextWidth;
    if (canvas.height !== nextHeight) canvas.height = nextHeight;
    render();
  }

  function render() {
    if (!gl || !program || !buffer) return;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (!count) return;
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    const requiredBytes = count * components * Float32Array.BYTES_PER_ELEMENT;
    if (requiredBytes > capacityBytes) {
      capacityBytes = growCapacity(capacityBytes, requiredBytes);
      gl.bufferData(gl.ARRAY_BUFFER, capacityBytes, gl.DYNAMIC_DRAW);
      pointDataDirty = true;
    }
    if (pointDataDirty) {
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, points, 0, count * components);
      pointDataDirty = false;
    }
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, components, gl.FLOAT, false, 0, 0);
    gl.uniform2f(viewportLocation, canvas.width, canvas.height);
    gl.uniform1f(pointSizeLocation, pointSize);
    gl.uniform4fv(colorLocation, color);
    gl.uniform1i(worldModeLocation, worldMode ? 1 : 0);
    if (worldMode) {
      gl.uniform3fv(worldOriginLocation, projection.worldOrigin);
      gl.uniform2fv(screenOriginLocation, projection.screenOrigin);
      gl.uniform2fv(xAxisLocation, projection.xAxis);
      gl.uniform2fv(yAxisLocation, projection.yAxis);
      gl.uniform2fv(zAxisLocation, projection.zAxis);
    }
    gl.drawArrays(gl.POINTS, 0, count);
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    if (gl && buffer) gl.deleteBuffer(buffer);
    if (gl && program) gl.deleteProgram(program);
    gl = null;
    buffer = null;
    program = null;
    points = new Float32Array();
    count = 0;
    worldMode = false;
    pointDataDirty = false;
  }

  function assertAlive() {
    if (destroyed) throw new Error('screen-space point-cloud renderer is destroyed');
  }

  return Object.freeze({
    initialize,
    setPoints,
    setWorldPoints,
    resize,
    destroy,
    [RETAINED_POINT_REDRAW]: render,
    get backend() { return gl ? 'webgl2-points' : null; },
  });
}

function normalizeProjection(value, current, scratch) {
  const worldOrigin = normalizeVector(value?.worldOrigin, 3, 'worldOrigin', current?.worldOrigin, scratch.worldOrigin);
  const screenOrigin = normalizeVector(value?.screenOrigin, 2, 'screenOrigin', current?.screenOrigin, scratch.screenOrigin);
  const xAxis = normalizeVector(value?.xAxis, 2, 'xAxis', current?.xAxis, scratch.xAxis);
  const yAxis = normalizeVector(value?.yAxis, 2, 'yAxis', current?.yAxis, scratch.yAxis);
  const zAxis = normalizeVector(value?.zAxis, 2, 'zAxis', current?.zAxis, scratch.zAxis);
  if (current
    && worldOrigin === current.worldOrigin
    && screenOrigin === current.screenOrigin
    && xAxis === current.xAxis
    && yAxis === current.yAxis
    && zAxis === current.zAxis) {
    return current;
  }
  return Object.freeze({ worldOrigin, screenOrigin, xAxis, yAxis, zAxis });
}

function normalizeVector(value, length, name, current, scratch) {
  if (!Array.isArray(value) || value.length < length) throw new TypeError(`${name} must contain ${length} values`);
  for (let index = 0; index < length; index += 1) scratch[index] = Number(value[index]);
  for (let index = 0; index < length; index += 1) {
    if (!Number.isFinite(scratch[index])) throw new TypeError(`${name} values must be finite`);
  }
  if (current?.length === length) {
    let unchanged = true;
    for (let index = 0; index < length; index += 1) unchanged &&= current[index] === scratch[index];
    if (unchanged) return current;
  }
  return Object.freeze(Array.from(scratch));
}

function finiteVector(value, length, name) {
  if (!Array.isArray(value) || value.length < length) throw new TypeError(`${name} must contain ${length} values`);
  const result = value.slice(0, length).map(Number);
  if (!result.every(Number.isFinite)) throw new TypeError(`${name} values must be finite`);
  return result;
}

function normalizeColor(value, current = null, scratch = new Float64Array(4)) {
  const source = Array.isArray(value) || ArrayBuffer.isView(value) ? value : DEFAULT_COLOR;
  for (let index = 0; index < 4; index += 1) {
    scratch[index] = Math.max(0, Math.min(1, Number(source[index] ?? (index === 3 ? 1 : 0)) || 0));
  }
  if (current?.length === 4) {
    let unchanged = true;
    for (let index = 0; index < 4; index += 1) unchanged &&= current[index] === scratch[index];
    if (unchanged) return current;
  }
  return Array.from(scratch);
}

function growCapacity(current, required) {
  let capacity = Math.max(1024, current);
  while (capacity < required) capacity *= 2;
  return capacity;
}

function createProgram(gl, vertexSource, fragmentSource) {
  const vertex = createShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragment = createShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const shaderProgram = gl.createProgram();
  gl.attachShader(shaderProgram, vertex);
  gl.attachShader(shaderProgram, fragment);
  gl.bindAttribLocation(shaderProgram, 0, 'a_position');
  gl.linkProgram(shaderProgram);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(shaderProgram, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(shaderProgram) || 'point-cloud program link failed';
    gl.deleteProgram(shaderProgram);
    throw new Error(message);
  }
  return shaderProgram;
}

function createShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) || 'point-cloud shader compilation failed';
    gl.deleteShader(shader);
    throw new Error(message);
  }
  return shader;
}

const VERTEX_SHADER = `#version 300 es
layout(location = 0) in vec3 a_position;
uniform vec2 u_viewport;
uniform float u_point_size;
uniform bool u_world_mode;
uniform vec3 u_world_origin;
uniform vec2 u_screen_origin;
uniform vec2 u_x_axis;
uniform vec2 u_y_axis;
uniform vec2 u_z_axis;
void main() {
  vec2 screen_position = a_position.xy;
  if (u_world_mode) {
    vec3 relative = a_position - u_world_origin;
    screen_position = u_screen_origin
      + relative.x * u_x_axis
      + relative.y * u_y_axis
      + relative.z * u_z_axis;
  }
  gl_Position = vec4(
    screen_position.x / u_viewport.x * 2.0 - 1.0,
    1.0 - screen_position.y / u_viewport.y * 2.0,
    0.0,
    1.0
  );
  gl_PointSize = u_point_size;
}`;

const FRAGMENT_SHADER = `#version 300 es
precision mediump float;
uniform vec4 u_color;
out vec4 out_color;
void main() {
  float distance_from_center = length(gl_PointCoord - vec2(0.5));
  float coverage = 1.0 - smoothstep(0.42, 0.5, distance_from_center);
  if (coverage <= 0.0) discard;
  out_color = vec4(u_color.rgb, u_color.a * coverage);
}`;
