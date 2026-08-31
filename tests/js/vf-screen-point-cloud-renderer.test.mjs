import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createScreenSpacePointCloudRenderer,
  projectPointCloud3DToScreen
} from '../../web/vf-ui/geom/vf-screen-point-cloud-renderer.mjs';
import {
  setRetainedWorldPointCloud,
  setRetainedWorldPointCloud2D
} from '../../web/vf-ui/geom/internal/vf-retained-point-cloud-camera.mjs';

function trackedWebGl() {
  const state = {
    createdBuffers: [],
    bufferDataCalls: [],
    bufferSubDataCalls: [],
    draws: [],
    uniforms: new Map(),
    boundBuffer: null,
    uploadedPoints: null,
    components: 0
  };
  let nextId = 0;
  const gl = {
    VERTEX_SHADER: 0x8b31,
    FRAGMENT_SHADER: 0x8b30,
    COMPILE_STATUS: 0x8b81,
    LINK_STATUS: 0x8b82,
    BLEND: 0x0be2,
    SRC_ALPHA: 0x0302,
    ONE_MINUS_SRC_ALPHA: 0x0303,
    COLOR_BUFFER_BIT: 0x4000,
    ARRAY_BUFFER: 0x8892,
    DYNAMIC_DRAW: 0x88e8,
    FLOAT: 0x1406,
    POINTS: 0,
    createShader: (type) => ({ id: ++nextId, type }),
    shaderSource() {},
    compileShader() {},
    getShaderParameter: () => true,
    getShaderInfoLog: () => '',
    deleteShader() {},
    createProgram: () => ({ id: ++nextId }),
    attachShader() {},
    bindAttribLocation() {},
    linkProgram() {},
    getProgramParameter: () => true,
    getProgramInfoLog: () => '',
    deleteProgram() {},
    createBuffer() {
      const buffer = { id: ++nextId };
      state.createdBuffers.push(buffer);
      return buffer;
    },
    deleteBuffer() {},
    getUniformLocation: (_program, name) => name,
    enable() {},
    blendFunc() {},
    viewport() {},
    clearColor() {},
    clear() {},
    useProgram() {},
    bindBuffer(_target, buffer) { state.boundBuffer = buffer; },
    bufferData(_target, size) { state.bufferDataCalls.push({ buffer: state.boundBuffer, size }); },
    bufferSubData(_target, offset, points, sourceOffset, length) {
      state.uploadedPoints = points;
      state.bufferSubDataCalls.push({
        buffer: state.boundBuffer,
        offset,
        points,
        sourceOffset,
        length
      });
    },
    enableVertexAttribArray() {},
    vertexAttribPointer(_index, components) { state.components = components; },
    uniform2f(location, x, y) { state.uniforms.set(location, [x, y]); },
    uniform1f(location, value) { state.uniforms.set(location, value); },
    uniform4fv(location, value) { state.uniforms.set(location, [...value]); },
    uniform1i(location, value) { state.uniforms.set(location, value); },
    uniform3fv(location, value) { state.uniforms.set(location, [...value]); },
    uniform2fv(location, value) { state.uniforms.set(location, [...value]); },
    drawArrays(_mode, _first, count) {
      const points = state.uploadedPoints;
      const origin = state.uniforms.get('u_world_origin') ?? [0, 0, 0];
      const screen = state.uniforms.get('u_screen_origin') ?? [0, 0];
      const xAxis = state.uniforms.get('u_x_axis') ?? [1, 0];
      const yAxis = state.uniforms.get('u_y_axis') ?? [0, 1];
      const zAxis = state.uniforms.get('u_z_axis') ?? [0, 0];
      const projectedFirstPoint = points && state.uniforms.get('u_world_mode') === 1 ? [
        screen[0]
          + (points[0] - origin[0]) * xAxis[0]
          + (points[1] - origin[1]) * yAxis[0]
          + ((state.components === 3 ? points[2] : 0) - origin[2]) * zAxis[0],
        screen[1]
          + (points[0] - origin[0]) * xAxis[1]
          + (points[1] - origin[1]) * yAxis[1]
          + ((state.components === 3 ? points[2] : 0) - origin[2]) * zAxis[1]
      ] : null;
      state.draws.push({ buffer: state.boundBuffer, count, projectedFirstPoint });
    }
  };
  return { gl, state };
}

function projection(worldOrigin = [0, 0, 0]) {
  return {
    worldOrigin,
    screenOrigin: [640, 360],
    xAxis: [640, 0],
    yAxis: [0, -360],
    zAxis: [0, 0]
  };
}

test('projects a compact 3D point cloud into one packed screen buffer', () => {
  const positions = new Float64Array([
    1, 2, 3,
    -1, 0, 2
  ]);
  const projected = projectPointCloud3DToScreen(positions, 2, {
    worldOrigin: [0, 0, 0],
    screenOrigin: [400, 300],
    xAxis: [10, 1],
    yAxis: [2, -8],
    zAxis: [-1, -3]
  });

  assert.ok(projected instanceof Float32Array);
  assert.deepEqual([...projected], [411, 276, 388, 293]);
});

test('accepts packed 3D float positions for projection in the GPU vertex shader', () => {
  const renderer = createScreenSpacePointCloudRenderer({ getContext: () => null });
  const positions = new Float32Array([1, 2, 3, -1, 0, 2]);
  assert.doesNotThrow(() => renderer.setWorldPoints(positions, {
    worldOrigin: [0, 0, 0],
    screenOrigin: [400, 300],
    xAxis: [10, 1],
    yAxis: [2, -8],
    zAxis: [-1, -3]
  }, { count: 2, pointSize: 8 }));
});

test('projects 100,000 points without expanding them into marker triangles', () => {
  const count = 100_000;
  const positions = new Float64Array(count * 3);
  for (let index = 0; index < count; index += 1) {
    positions[index * 3] = index * 1e-6;
    positions[index * 3 + 1] = index * -1e-7;
  }
  const started = performance.now();
  const projected = projectPointCloud3DToScreen(positions, count, {
    worldOrigin: [0, 0, 0],
    screenOrigin: [600, 400],
    xAxis: [1000, 0],
    yAxis: [0, -1000],
    zAxis: [0, 0]
  });
  const elapsed = performance.now() - started;

  assert.equal(projected.length, count * 2);
  assert.ok(elapsed < 50, `100k point projection took ${elapsed.toFixed(1)} ms`);
});

test('retains one million-point GPU upload across camera-only pan frames', async () => {
  const { gl, state } = trackedWebGl();
  const renderer = createScreenSpacePointCloudRenderer({
    width: 1280,
    height: 720,
    getContext: () => gl
  });
  await renderer.initialize();
  const points = new Float32Array(1_000_000 * 2);
  setRetainedWorldPointCloud2D(renderer, points, projection(), { count: 1_000_000, pointSize: 2 });

  for (let frame = 0; frame < 240; frame += 1) {
    const phase = 2 * Math.PI * frame / 240;
    setRetainedWorldPointCloud2D(renderer, points, projection([
      0.2 * Math.sin(phase),
      0.1 * Math.cos(phase),
      0
    ]), { count: 1_000_000, pointSize: 2 });
  }

  assert.equal(state.createdBuffers.length, 1);
  assert.equal(state.bufferDataCalls.length, 1);
  assert.equal(state.bufferSubDataCalls.length, 1);
  assert.equal(state.bufferSubDataCalls[0].points, points);
  assert.equal(state.bufferSubDataCalls[0].length, 2_000_000);
  assert.equal(state.components, 2);
  assert.equal(state.draws.length, 241);
  assert.ok(state.draws.every(({ buffer }) => buffer === state.createdBuffers[0]));
});

test('retained camera change redraws the same point buffer at a new output position', async () => {
  const { gl, state } = trackedWebGl();
  const renderer = createScreenSpacePointCloudRenderer({
    width: 1280,
    height: 720,
    getContext: () => gl
  });
  await renderer.initialize();
  const points = new Float32Array([0.25, -0.5, 0]);
  setRetainedWorldPointCloud(renderer, points, projection(), { count: 1, pointSize: 2 });
  setRetainedWorldPointCloud(renderer, points, projection([0.1, -0.2, 0]), { count: 1, pointSize: 2 });

  assert.deepEqual(state.draws.map(({ projectedFirstPoint }) => projectedFirstPoint), [
    [800, 540],
    [736, 468]
  ]);
  assert.equal(state.bufferSubDataCalls.length, 1);
});

test('identical retained state is a no-op while visual state changes still redraw', async () => {
  const { gl, state } = trackedWebGl();
  const renderer = createScreenSpacePointCloudRenderer({
    width: 1280,
    height: 720,
    getContext: () => gl
  });
  await renderer.initialize();
  const points = new Float32Array([0.25, -0.5]);
  const options = { count: 1, pointSize: 2, color: [0.4, 0.9, 1, 0.9] };
  setRetainedWorldPointCloud2D(renderer, points, projection(), options);
  setRetainedWorldPointCloud2D(renderer, points, projection(), {
    ...options,
    color: [...options.color]
  });
  assert.equal(state.draws.length, 1);
  assert.equal(state.bufferSubDataCalls.length, 1);

  setRetainedWorldPointCloud2D(renderer, points, projection(), { ...options, pointSize: 3 });
  assert.equal(state.draws.length, 2);
});

test('ordinary world-point updates preserve mutable-buffer upload behavior', async () => {
  const { gl, state } = trackedWebGl();
  const renderer = createScreenSpacePointCloudRenderer({
    width: 1280,
    height: 720,
    getContext: () => gl
  });
  await renderer.initialize();
  const points = new Float32Array([0, 0, 0]);
  renderer.setWorldPoints(points, projection(), { count: 1 });
  points[0] = 0.5;
  renderer.setWorldPoints(points, projection(), { count: 1 });
  assert.equal(state.bufferSubDataCalls.length, 2);
});
