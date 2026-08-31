import { bgraRowsToRgba } from './vkf-marker-impostor.mjs';
import { INDICATOR_PROTOCOL } from '../protocol.mjs';
import { installWebGpuFixtureTracker } from '../retention-ledger.mjs';

export const RAW_WEBGPU_VERSION = 'WebGPU 1.0';

const SHADER = `
struct Orbit {
  basis_radius: vec4<f32>,
  projection: vec4<f32>,
}
@group(0) @binding(0) var<uniform> orbit: Orbit;

struct Instance {
  @location(0) position: vec3<f32>,
  @location(1) color: vec4<f32>,
}
struct VertexOutput {
  @builtin(position) clip: vec4<f32>,
  @location(0) local: vec2<f32>,
  @location(1) color: vec4<f32>,
}

@vertex fn vertexMain(instance: Instance, @builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  let corners = array<vec2<f32>, 6>(
    vec2<f32>(-1.06, -1.06), vec2<f32>(1.06, -1.06), vec2<f32>(1.06, 1.06),
    vec2<f32>(-1.06, -1.06), vec2<f32>(1.06, 1.06), vec2<f32>(-1.06, 1.06)
  );
  let local = corners[vertexIndex];
  let cosine = orbit.basis_radius.x;
  let sine = orbit.basis_radius.y;
  let x = (cosine * instance.position.x - sine * instance.position.z)
    / (orbit.projection.x * orbit.projection.y);
  let y = instance.position.y / orbit.projection.x;
  let cameraDepth = sine * instance.position.x + cosine * instance.position.z;
  var output: VertexOutput;
  output.clip = vec4<f32>(
    x + local.x * orbit.basis_radius.z,
    y + local.y * orbit.basis_radius.w,
    0.5 - cameraDepth * 0.24,
    1.0
  );
  output.local = local;
  output.color = instance.color;
  return output;
}

@vertex fn pointVertexMain(instance: Instance) -> VertexOutput {
  let cosine = orbit.basis_radius.x;
  let sine = orbit.basis_radius.y;
  let x = (cosine * instance.position.x - sine * instance.position.z)
    / (orbit.projection.x * orbit.projection.y);
  let y = instance.position.y / orbit.projection.x;
  let cameraDepth = sine * instance.position.x + cosine * instance.position.z;
  var output: VertexOutput;
  output.clip = vec4<f32>(x, y, 0.5 - cameraDepth * 0.24, 1.0);
  output.local = vec2<f32>(0.0);
  output.color = instance.color;
  return output;
}

@fragment fn fragmentMain(input: VertexOutput) -> @location(0) vec4<f32> {
  let radial = length(input.local);
  let edge = max(fwidth(radial), 1e-4);
  let mask = 1.0 - smoothstep(1.0 - edge, 1.0 + edge, radial);
  if (mask <= 1e-4) { discard; }
  return vec4<f32>(input.color.rgb * mask, mask);
}

@fragment fn pointFragmentMain(input: VertexOutput) -> @location(0) vec4<f32> {
  return input.color;
}
`;

export function rawPrimitiveForPointSize(pointSizePx) {
  return pointSizePx === 1 ? 'point-list' : 'analytic-quad';
}

export function rawOrbitUniform(frame, pointSizePx, viewport) {
  const angle = 2 * Math.PI * frame / INDICATOR_PROTOCOL.orbitFrames;
  return new Float32Array([
    Math.cos(angle), Math.sin(angle), pointSizePx / viewport[0], pointSizePx / viewport[1],
    INDICATOR_PROTOCOL.renderState.orthographicHalfHeight,
    viewport[0] / viewport[1],
    0,
    0,
  ]);
}

export function createRawWebGpuAdapter(host, fixture, options = {}) {
  const viewport = options.viewport ?? INDICATOR_PROTOCOL.viewport;
  const canvas = document.createElement('canvas');
  [canvas.width, canvas.height] = viewport;
  Object.assign(canvas.style, { width: `${viewport[0]}px`, height: `${viewport[1]}px` });
  host.replaceChildren(canvas);
  let adapter;
  let device;
  let context;
  let format;
  let pipeline;
  let pointPipeline;
  let bindGroup;
  let pointBindGroup;
  let fixtureBuffer;
  let uniformBuffer;
  let colorTexture;
  let msaaTexture;
  let depthTexture;
  let captureBuffer;
  let captureBytesPerRow;
  let tracker;
  let cameraUniformWrites = 0;
  let timestampQuerySet = null;
  let timestampResolveBuffer = null;
  let timestampReadBuffer = null;
  let timestampCount = 0;

  function encodeFrame(frame, lane, phase) {
    const uniform = rawOrbitUniform(frame, lane.pointSizePx, viewport);
    device.queue.writeBuffer(uniformBuffer, 0, uniform);
    const encoder = device.createCommandEncoder({ label: `raw-webgpu-${phase ?? 'frame'}` });
    let timestampWrites;
    if (phase === 'raf-measured' && timestampQuerySet) {
      timestampWrites = {
        querySet: timestampQuerySet,
        beginningOfPassWriteIndex: timestampCount * 2,
        endOfPassWriteIndex: timestampCount * 2 + 1,
      };
      timestampCount += 1;
    }
    const pass = encoder.beginRenderPass({
      label: 'raw-webgpu-retained-cloud',
      colorAttachments: [{
        view: msaaTexture.createView(),
        resolveTarget: colorTexture.createView(),
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: 'clear',
        storeOp: 'discard',
      }],
      depthStencilAttachment: {
        view: depthTexture.createView(),
        depthClearValue: 1,
        depthLoadOp: 'clear',
        depthStoreOp: 'discard',
      },
      timestampWrites,
    });
    const pointList = rawPrimitiveForPointSize(lane.pointSizePx) === 'point-list';
    pass.setPipeline(pointList ? pointPipeline : pipeline);
    pass.setBindGroup(0, pointList ? pointBindGroup : bindGroup);
    pass.setVertexBuffer(0, fixtureBuffer);
    pass.draw(pointList ? 1 : 6, fixture.pointCount);
    pass.end();
    device.queue.submit([encoder.finish()]);
  }

  return Object.freeze({
    id: 'raw-webgpu-floor',
    version: RAW_WEBGPU_VERSION,
    async initialize(lane) {
      const started = performance.now();
      tracker = installWebGpuFixtureTracker(fixture.byteLength);
      adapter = await navigator.gpu?.requestAdapter();
      if (!adapter) throw new Error('raw WebGPU adapter unavailable');
      const timestampSupported = adapter.features.has('timestamp-query');
      device = await adapter.requestDevice({
        requiredFeatures: timestampSupported ? ['timestamp-query'] : [],
      });
      format = navigator.gpu.getPreferredCanvasFormat();
      context = canvas.getContext('webgpu');
      context.configure({ device, format, alphaMode: 'premultiplied', colorSpace: 'srgb' });
      const module = device.createShaderModule({ code: SHADER, label: 'raw-retained-cloud' });
      pipeline = device.createRenderPipeline({
        label: 'raw-retained-cloud',
        layout: 'auto',
        vertex: {
          module,
          entryPoint: 'vertexMain',
          buffers: [{
            arrayStride: INDICATOR_PROTOCOL.strideBytes,
            stepMode: 'instance',
            attributes: [
              { shaderLocation: 0, format: 'float32x3', offset: 0 },
              { shaderLocation: 1, format: 'unorm8x4', offset: 12 },
            ],
          }],
        },
        fragment: {
          module,
          entryPoint: 'fragmentMain',
          targets: [{
            format,
            blend: {
              color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
              alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            },
          }],
        },
        primitive: { topology: 'triangle-list' },
        multisample: { count: INDICATOR_PROTOCOL.renderState.sampleCount },
        depthStencil: {
          format: 'depth24plus',
          depthWriteEnabled: true,
          depthCompare: 'less',
        },
      });
      pointPipeline = device.createRenderPipeline({
        label: 'raw-retained-cloud-1px-points',
        layout: 'auto',
        vertex: {
          module,
          entryPoint: 'pointVertexMain',
          buffers: [{
            arrayStride: INDICATOR_PROTOCOL.strideBytes,
            stepMode: 'instance',
            attributes: [
              { shaderLocation: 0, format: 'float32x3', offset: 0 },
              { shaderLocation: 1, format: 'unorm8x4', offset: 12 },
            ],
          }],
        },
        fragment: {
          module,
          entryPoint: 'pointFragmentMain',
          targets: [{ format }],
        },
        primitive: { topology: 'point-list' },
        multisample: { count: INDICATOR_PROTOCOL.renderState.sampleCount },
        depthStencil: {
          format: 'depth24plus',
          depthWriteEnabled: true,
          depthCompare: 'less',
        },
      });
      fixtureBuffer = device.createBuffer({
        label: 'raw-retained-cloud-fixture',
        size: fixture.byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      });
      device.queue.writeBuffer(fixtureBuffer, 0, fixture.bytes);
      uniformBuffer = device.createBuffer({
        label: 'raw-retained-cloud-orbit',
        size: 32,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      bindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
      });
      pointBindGroup = device.createBindGroup({
        layout: pointPipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
      });
      colorTexture = device.createTexture({
        label: 'raw-retained-cloud-color',
        size: [viewport[0], viewport[1]],
        format,
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
      });
      msaaTexture = device.createTexture({
        label: 'raw-retained-cloud-msaa',
        size: [viewport[0], viewport[1]],
        sampleCount: INDICATOR_PROTOCOL.renderState.sampleCount,
        format,
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
      });
      depthTexture = device.createTexture({
        label: 'raw-retained-cloud-depth',
        size: [viewport[0], viewport[1]],
        sampleCount: INDICATOR_PROTOCOL.renderState.sampleCount,
        format: 'depth24plus',
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
      });
      captureBytesPerRow = Math.ceil(viewport[0] * 4 / 256) * 256;
      captureBuffer = device.createBuffer({
        label: 'raw-retained-cloud-readback',
        size: captureBytesPerRow * viewport[1],
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });
      if (timestampSupported) {
        const queryBytes = INDICATOR_PROTOCOL.measuredFrames * 2 * 8;
        timestampQuerySet = device.createQuerySet({
          type: 'timestamp', count: INDICATOR_PROTOCOL.measuredFrames * 2,
        });
        timestampResolveBuffer = device.createBuffer({
          size: queryBytes,
          usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
        });
        timestampReadBuffer = device.createBuffer({
          size: queryBytes,
          usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        });
      }
      tracker.registerFixtureBuffer(fixtureBuffer);
      encodeFrame(0, lane, 'cold-first-visible');
      await device.queue.onSubmittedWorkDone();
      tracker.markInitialized();
      return {
        firstVisibleMs: performance.now() - started,
        uploadBytes: fixture.byteLength,
        estimatedGpuBytes: fixture.byteLength
          + captureBytesPerRow * viewport[1]
          + viewport[0] * viewport[1] * 4 * (INDICATOR_PROTOCOL.renderState.sampleCount + 2),
        jsHeapBytes: performance.memory?.usedJSHeapSize ?? null,
        backend: 'raw WebGPU analytic point impostor floor',
        timestampMode: timestampSupported ? 'WebGPU timestamp-query pass duration' : 'unsupported',
      };
    },
    async submitFrame(frame, lane, contextInfo = {}) {
      encodeFrame(frame, lane, contextInfo.phase);
      cameraUniformWrites += 1;
      return { cameraAngleRadians: 2 * Math.PI * frame / INDICATOR_PROTOCOL.orbitFrames };
    },
    async completeGpu() { await device.queue.onSubmittedWorkDone(); },
    async drainGpu() { await device.queue.onSubmittedWorkDone(); },
    async capture(frame) {
      const encoder = device.createCommandEncoder({ label: 'raw-retained-cloud-readback' });
      encoder.copyTextureToBuffer(
        { texture: colorTexture },
        { buffer: captureBuffer, bytesPerRow: captureBytesPerRow, rowsPerImage: viewport[1] },
        { width: viewport[0], height: viewport[1], depthOrArrayLayers: 1 },
      );
      device.queue.submit([encoder.finish()]);
      await captureBuffer.mapAsync(GPUMapMode.READ);
      const padded = new Uint8Array(captureBuffer.getMappedRange()).slice();
      captureBuffer.unmap();
      return {
        frame,
        width: viewport[0],
        height: viewport[1],
        rgba: bgraRowsToRgba(padded, viewport[0], viewport[1], captureBytesPerRow, format),
      };
    },
    async collectGpuTimestamps() {
      if (!timestampQuerySet) return null;
      if (timestampCount !== INDICATOR_PROTOCOL.measuredFrames) {
        throw new Error(`raw WebGPU timestamp count ${timestampCount} is incomplete`);
      }
      const encoder = device.createCommandEncoder({ label: 'raw-retained-cloud-timestamp-resolve' });
      encoder.resolveQuerySet(timestampQuerySet, 0, timestampCount * 2, timestampResolveBuffer, 0);
      encoder.copyBufferToBuffer(timestampResolveBuffer, 0, timestampReadBuffer, 0, timestampCount * 16);
      device.queue.submit([encoder.finish()]);
      await timestampReadBuffer.mapAsync(GPUMapMode.READ);
      const values = new BigUint64Array(timestampReadBuffer.getMappedRange()).slice();
      timestampReadBuffer.unmap();
      return Array.from({ length: timestampCount }, (_, index) => (
        Number(values[index * 2 + 1] - values[index * 2]) / 1_000_000
      ));
    },
    retainedEvidence() {
      return {
        ...tracker.evidence(),
        cameraUniformWritesAfterInitialize: cameraUniformWrites,
        cameraUniformBytesAfterInitialize: cameraUniformWrites * 32,
        fixtureBufferIdentityStable: true,
      };
    },
    async destroy() {
      try {
        for (const resource of [
          timestampReadBuffer, timestampResolveBuffer, timestampQuerySet,
          captureBuffer, depthTexture, msaaTexture, colorTexture,
          uniformBuffer, fixtureBuffer,
        ]) {
          try { resource?.destroy(); } catch (_) {}
        }
        device?.destroy();
      } finally {
        tracker?.restore();
      }
    },
  });
}
