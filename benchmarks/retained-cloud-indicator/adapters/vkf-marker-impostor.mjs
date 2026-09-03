import { INDICATOR_PROTOCOL } from '../protocol.mjs';
import { installWebGpuFixtureTracker } from '../retention-ledger.mjs';

export const VKF_MARKER_IMPOSTOR_VERSION = '0.4.0';
const ORTHO_SCALE = 1.1;

const FLAT_OPAQUE_MARKER_SHADER = `
struct Scene {
  mvp: mat4x4<f32>,
  model: mat4x4<f32>,
  cam_pos: vec3<f32>,
  _pad0: f32,
}
@group(0) @binding(0) var<uniform> scene: Scene;

struct MarkerInput {
  @location(0) position: vec3<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) base_color: vec4<f32>,
  @location(3) center_radius: vec4<f32>,
  @location(4) color: vec4<f32>,
}
struct MarkerOutput {
  @builtin(position) clip: vec4<f32>,
  @location(0) local: vec2<f32>,
  @location(1) color: vec4<f32>,
}

@vertex fn flatPointVertex(input: MarkerInput) -> MarkerOutput {
  var output: MarkerOutput;
  output.clip = scene.mvp * vec4<f32>(input.center_radius.xyz, 1.0);
  output.local = vec2<f32>(0.0);
  output.color = input.color;
  return output;
}

@vertex fn analyticCircleVertex(input: MarkerInput) -> MarkerOutput {
  let center = input.center_radius.xyz;
  let radius = input.center_radius.w;
  let view_direction = normalize(scene.cam_pos - center);
  var reference_up = vec3<f32>(0.0, 0.0, 1.0);
  if (abs(dot(view_direction, reference_up)) >= 0.92) {
    reference_up = vec3<f32>(0.0, 1.0, 0.0);
  }
  let right = normalize(cross(reference_up, view_direction));
  let up = normalize(cross(view_direction, right));
  let world = center
    + (right * input.position.x * radius)
    + (up * input.position.y * radius);
  var output: MarkerOutput;
  output.clip = scene.mvp * vec4<f32>(world, 1.0);
  output.local = input.position.xy;
  output.color = input.color;
  return output;
}

@fragment fn flatPointFragment(input: MarkerOutput) -> @location(0) vec4<f32> {
  return input.color;
}

@fragment fn analyticCircleFragment(input: MarkerOutput) -> @location(0) vec4<f32> {
  let radial = length(input.local);
  let edge = max(fwidth(radial), 1e-4);
  let mask = 1.0 - smoothstep(1.0 - edge, 1.0 + edge, radial);
  if (mask <= 1e-4) { discard; }
  return vec4<f32>(input.color.rgb * mask, mask);
}
`;

export function createVkfFlatOpaqueMarkerPipeline(renderer, pointSizePx) {
  if (pointSizePx !== 1 && pointSizePx !== 4) {
    throw new RangeError('VKF exact marker pipeline requires a 1px or 4px lane');
  }
  const device = renderer?._device;
  if (!device || !renderer._bindLayout || !renderer._clusteredLightBindLayout || !renderer._format) {
    throw new Error('VKF exact marker pipeline requires an initialized renderer');
  }
  const module = device.createShaderModule({
    code: FLAT_OPAQUE_MARKER_SHADER,
    label: 'vkf-retained-cloud-flat-opaque-marker',
  });
  const layout = device.createPipelineLayout({
    bindGroupLayouts: [renderer._bindLayout, renderer._clusteredLightBindLayout],
  });
  const analytic = pointSizePx === 4;
  const target = { format: renderer._format };
  if (analytic) {
    target.blend = {
      color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
      alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
    };
  }
  return device.createRenderPipeline({
    label: analytic
      ? 'vkf-retained-cloud-analytic-circle'
      : 'vkf-retained-cloud-discrete-point',
    layout,
    vertex: {
      module,
      entryPoint: analytic ? 'analyticCircleVertex' : 'flatPointVertex',
      buffers: [{
        arrayStride: 40,
        attributes: [
          { shaderLocation: 0, format: 'float32x3', offset: 0 },
          { shaderLocation: 1, format: 'float32x3', offset: 12 },
          { shaderLocation: 2, format: 'float32x4', offset: 24 },
        ],
      }, {
        arrayStride: 32,
        stepMode: 'instance',
        attributes: [
          { shaderLocation: 3, format: 'float32x4', offset: 0 },
          { shaderLocation: 4, format: 'float32x4', offset: 16 },
        ],
      }],
    },
    fragment: {
      module,
      entryPoint: analytic ? 'analyticCircleFragment' : 'flatPointFragment',
      targets: [target],
    },
    primitive: { topology: analytic ? 'triangle-list' : 'point-list' },
    multisample: { count: INDICATOR_PROTOCOL.renderState.sampleCount },
    depthStencil: {
      format: 'depth24plus',
      depthWriteEnabled: true,
      depthCompare: 'less',
    },
  });
}

export function bgraRowsToRgba(source, width, height, bytesPerRow, format = 'bgra8unorm') {
  if (!(source instanceof Uint8Array) || source.byteLength < bytesPerRow * height) {
    throw new TypeError('texture readback must contain every padded row');
  }
  const rgba = new Uint8Array(width * height * 4);
  const swapRedBlue = String(format).startsWith('bgra');
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sourceOffset = y * bytesPerRow + x * 4;
      const targetOffset = (y * width + x) * 4;
      rgba[targetOffset] = source[sourceOffset + (swapRedBlue ? 2 : 0)];
      rgba[targetOffset + 1] = source[sourceOffset + 1];
      rgba[targetOffset + 2] = source[sourceOffset + (swapRedBlue ? 0 : 2)];
      rgba[targetOffset + 3] = source[sourceOffset + 3];
    }
  }
  return rgba;
}

export function vkfMarkerInstances(fixture, pointSizePx, viewport) {
  if (!(fixture?.positions instanceof Float32Array) || !(fixture?.colors instanceof Uint8Array)) {
    throw new TypeError('VKF marker instances require the canonical XYZ+RGBA8 fixture');
  }
  const radius = pointSizePx * ORTHO_SCALE / viewport[1];
  const instances = new Float32Array(fixture.pointCount * 8);
  for (let index = 0; index < fixture.pointCount; index += 1) {
    const sourcePosition = index * 3;
    const sourceColor = index * 4;
    const target = index * 8;
    instances[target] = fixture.positions[sourcePosition];
    instances[target + 1] = fixture.positions[sourcePosition + 1];
    instances[target + 2] = fixture.positions[sourcePosition + 2];
    instances[target + 3] = radius;
    instances[target + 4] = fixture.colors[sourceColor] / 255;
    instances[target + 5] = fixture.colors[sourceColor + 1] / 255;
    instances[target + 6] = fixture.colors[sourceColor + 2] / 255;
    instances[target + 7] = fixture.colors[sourceColor + 3] / 255;
  }
  return instances;
}

export function updateVkfOrbit(scene, frame) {
  if (!Number.isSafeInteger(frame) || frame < 0 || frame > INDICATOR_PROTOCOL.orbitFrames) {
    throw new RangeError('VKF orbit frame is outside the protocol');
  }
  const angle = 2 * Math.PI * frame / INDICATOR_PROTOCOL.orbitFrames;
  scene.camera.pos[0] = 3 * Math.sin(angle);
  scene.camera.pos[1] = 0;
  scene.camera.pos[2] = 3 * Math.cos(angle);
  return scene.camera;
}

export function createVkfMarkerScene(fixture, pointSizePx, viewport) {
  const instances = vkfMarkerInstances(fixture, pointSizePx, viewport);
  const aspect = viewport[0] / viewport[1];
  const near = 0.05;
  const far = 500;
  const halfWidth = ORTHO_SCALE * aspect;
  const inverseDepth = 1 / (near - far);
  const discrete = pointSizePx === 1;
  const mesh = {
    id: 'retained-cloud-marker-impostor',
    mode3d: true,
    label: 'retained-cloud-marker-impostor',
    vertices: discrete
      ? new Float32Array([0, 0, 0, 0, 0, 1, 1, 1, 1, 1])
      : new Float32Array([
        -1.06, -1.06, 0, 0, 0, 1, 1, 1, 1, 1,
         1.06, -1.06, 0, 0, 0, 1, 1, 1, 1, 1,
         1.06,  1.06, 0, 0, 0, 1, 1, 1, 1, 1,
        -1.06,  1.06, 0, 0, 0, 1, 1, 1, 1, 1,
      ]),
    indices: discrete
      ? new Uint32Array([0])
      : new Uint32Array([0, 1, 2, 0, 2, 3]),
    instances,
    instance_count: fixture.pointCount,
    instance_kind: 'point-impostor',
    topology: discrete ? 'point-list' : 'triangle-list',
    static_vertices: true,
    static_indices: true,
    static_instances: true,
    center: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    alpha: 1,
    transparent: !discrete,
    overlay_expanded: true,
    depth_write: true,
    no_lighting: true,
    no_cull: true,
    pickable: false,
  };
  const scene = {
    __revision: 1,
    parts: [mesh],
    camera: {
      pos: [0, 0, 3],
      target: [0, 0, 0],
      up: [0, 1, 0],
      projection: 'orthographic',
      ortho_scale: ORTHO_SCALE,
      projection_matrix: [
        1 / halfWidth, 0, 0, 0,
        0, 1 / ORTHO_SCALE, 0, 0,
        0, 0, inverseDepth, 0,
        0, 0, near * inverseDepth, 1,
      ],
      viewport_width_px: viewport[0],
      viewport_height_px: viewport[1],
    },
    background: [0, 0, 0, 1],
    lights: [],
  };
  mesh.camera = scene.camera;
  mesh.lights = scene.lights;
  return scene;
}

export function createVkfMarkerImpostorAdapter(host, fixture, options = {}) {
  const viewport = options.viewport ?? INDICATOR_PROTOCOL.viewport;
  const canvas = document.createElement('canvas');
  [canvas.width, canvas.height] = viewport;
  Object.assign(canvas.style, { width: `${viewport[0]}px`, height: `${viewport[1]}px` });
  host.replaceChildren(canvas);
  let renderer = null;
  let scene = null;
  let tracker = null;
  let fixtureBuffer = null;
  let captureBuffer = null;
  let captureBytesPerRow = 0;
  let cameraUniformWrites = 0;

  function evidence() {
    const tracked = tracker?.evidence() ?? {
      initialFixtureBufferWrites: 0,
      initialFixtureBufferBytes: 0,
      initialFixtureBufferAllocations: 0,
      fixtureBufferWritesAfterInitialize: 0,
      fixtureBufferBytesAfterInitialize: 0,
      fixtureBufferReallocationsAfterInitialize: 0,
    };
    return {
      ...tracked,
      cameraUniformWritesAfterInitialize: cameraUniformWrites,
      cameraUniformBytesAfterInitialize: cameraUniformWrites * 48,
      fixtureBufferIdentityStable: renderer?._parts?.[0]?.instanceBuf === fixtureBuffer,
      debug: renderer ? {
        format: renderer._format,
        partCount: renderer._parts?.length ?? 0,
        instanceCount: renderer._parts?.[0]?.instanceCount ?? 0,
        instanceKind: renderer._parts?.[0]?.instanceKind ?? null,
        indexCount: renderer._parts?.[0]?.ibCount ?? 0,
        renderEvidenceSequence: renderer._renderEvidenceSequence ?? null,
        lastPerfSample: renderer._lastPerfSample ?? null,
      } : null,
    };
  }

  return Object.freeze({
    id: 'vkf-marker-impostor',
    version: VKF_MARKER_IMPOSTOR_VERSION,
    async initialize(lane) {
      if (typeof globalThis.VfGeomWgpu !== 'function') {
        throw new Error('shipped VfGeomWgpu runtime is not loaded');
      }
      const started = performance.now();
      scene = createVkfMarkerScene(fixture, lane.pointSizePx, viewport);
      tracker = installWebGpuFixtureTracker(scene.parts[0].instances.byteLength);
      renderer = new globalThis.VfGeomWgpu(canvas, () => scene);
      renderer._renderOnDemand = true;
      const initialized = await renderer.init();
      if (initialized !== true) throw new Error('shipped VfGeomWgpu initialization failed');
      const markerPipeline = createVkfFlatOpaqueMarkerPipeline(renderer, lane.pointSizePx);
      renderer._pipePointImpostor = markerPipeline;
      renderer._pipePointImpostorDepth = markerPipeline;
      renderer._renderContent(performance.now());
      await renderer._device.queue.onSubmittedWorkDone();
      fixtureBuffer = renderer._parts?.[0]?.instanceBuf ?? null;
      if (!fixtureBuffer) throw new Error('marker_impostor instance buffer was not retained');
      if (!renderer._frameColorTex) throw new Error('marker_impostor frame color texture missing');
      captureBytesPerRow = Math.ceil(viewport[0] * 4 / 256) * 256;
      captureBuffer = renderer._device.createBuffer({
        label: 'retained-cloud-correctness-readback',
        size: captureBytesPerRow * viewport[1],
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });
      tracker.registerFixtureBuffer(fixtureBuffer);
      tracker.markInitialized();
      const firstVisibleMs = performance.now() - started;
      return {
        firstVisibleMs,
        uploadBytes: scene.parts[0].instances.byteLength,
        estimatedGpuBytes: scene.parts[0].instances.byteLength
          + scene.parts[0].vertices.byteLength
          + scene.parts[0].indices.byteLength,
        jsHeapBytes: performance.memory?.usedJSHeapSize ?? null,
        backend: 'shipped vf-geom-wgpu.js internal exact flat marker',
      };
    },
    async submitFrame(frame) {
      if (renderer?._parts?.[0]?.instanceBuf !== fixtureBuffer) {
        throw new Error('marker_impostor fixture buffer identity changed');
      }
      updateVkfOrbit(scene, frame);
      renderer._renderContent(performance.now());
      cameraUniformWrites += 1;
      return { cameraAngleRadians: 2 * Math.PI * frame / INDICATOR_PROTOCOL.orbitFrames };
    },
    async completeGpu() {
      await renderer._device.queue.onSubmittedWorkDone();
      return null;
    },
    async drainGpu() { await renderer._device.queue.onSubmittedWorkDone(); },
    async capture(frame) {
      const encoder = renderer._device.createCommandEncoder({
        label: 'retained-cloud-correctness-readback',
      });
      encoder.copyTextureToBuffer(
        { texture: renderer._frameColorTex },
        { buffer: captureBuffer, bytesPerRow: captureBytesPerRow, rowsPerImage: viewport[1] },
        { width: viewport[0], height: viewport[1], depthOrArrayLayers: 1 },
      );
      renderer._device.queue.submit([encoder.finish()]);
      await captureBuffer.mapAsync(GPUMapMode.READ);
      const padded = new Uint8Array(captureBuffer.getMappedRange()).slice();
      captureBuffer.unmap();
      return {
        frame,
        width: viewport[0],
        height: viewport[1],
        rgba: bgraRowsToRgba(padded, viewport[0], viewport[1], captureBytesPerRow, renderer._format),
      };
    },
    retainedEvidence: evidence,
    async destroy() {
      try {
        try { captureBuffer?.destroy(); } catch (_) {}
        renderer?.destroy();
      } finally {
        tracker?.restore();
        captureBuffer = null;
        renderer = null;
      }
    },
  });
}
