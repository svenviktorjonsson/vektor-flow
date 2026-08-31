import { INDICATOR_PROTOCOL } from '../protocol.mjs';
import { installWebGpuFixtureTracker } from '../retention-ledger.mjs';

export const VKF_MARKER_IMPOSTOR_VERSION = '0.4.0';
const ORTHO_SCALE = 1.1;

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
    // The shipped marker_impostor ABI uses negative alpha to select its
    // deterministic unlit color path while preserving absolute opacity.
    instances[target + 7] = -fixture.colors[sourceColor + 3] / 255;
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
  const mesh = {
    id: 'retained-cloud-marker-impostor',
    mode3d: true,
    label: 'retained-cloud-marker-impostor',
    vertices: new Float32Array([
      -1.06, -1.06, 0, 0, 0, 1, 1, 1, 1, 1,
       1.06, -1.06, 0, 0, 0, 1, 1, 1, 1, 1,
       1.06,  1.06, 0, 0, 0, 1, 1, 1, 1, 1,
      -1.06,  1.06, 0, 0, 0, 1, 1, 1, 1, 1,
    ]),
    indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
    instances,
    instance_count: fixture.pointCount,
    instance_kind: 'point-impostor',
    topology: 'triangle-list',
    static_vertices: true,
    static_indices: true,
    static_instances: true,
    center: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    alpha: 1,
    transparent: true,
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
        backend: 'shipped vf-geom-wgpu.js marker_impostor',
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
