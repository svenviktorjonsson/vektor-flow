const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const bridge = require("../../web/vf-ui/vf-compiled-runtime-bridge.js");
const adapter = require("../../web/vf-ui/vf-compiled-webgpu-adapter.js");

const gallery = path.resolve(
  __dirname,
  "../../examples/material_ui_gallery/.vkfbuild/app",
);

function fakeGpu() {
  const calls = [];
  const renderPass = () => ({
    setPipeline() {},
    setBindGroup() {},
    setViewport() {},
    setVertexBuffer() {},
    setIndexBuffer() {},
    draw(count, instances) { calls.push(["draw", count, instances]); },
    drawIndexed(count) { calls.push(["drawIndexed", count]); },
    end() {},
  });
  const computePass = () => ({
    setPipeline() {},
    setBindGroup() {},
    dispatchWorkgroups(x, y, z) { calls.push(["dispatch", x, y, z]); },
    end() {},
  });
  const device = {
    queue: {
      writeBuffer(_buffer, _offset, bytes) { calls.push(["write", bytes.byteLength]); },
      submit(buffers) { calls.push(["submit", buffers.length]); },
      async onSubmittedWorkDone() { calls.push(["workDone"]); },
    },
    createBuffer(descriptor) {
      if (descriptor.label === "vkf-compiled-frame-capture-readback") {
        const bytes = new Uint8Array(descriptor.size);
        for (let offset = 0; offset < bytes.length; offset += 4) {
          bytes[offset] = 87;
          bytes[offset + 1] = 87;
          bytes[offset + 2] = 87;
          bytes[offset + 3] = 255;
        }
        return {
          descriptor,
          async mapAsync() { calls.push(["mapCapture"]); },
          getMappedRange() { return bytes.buffer; },
          unmap() { calls.push(["unmapCapture"]); },
          destroy() { calls.push(["destroyCapture"]); },
        };
      }
      return { descriptor };
    },
    createTexture(descriptor) {
      return {
        descriptor,
        createView(options) { return { descriptor, options }; },
      };
    },
    createSampler(descriptor) { return { descriptor }; },
    createShaderModule(descriptor) { return { descriptor }; },
    async createComputePipelineAsync(descriptor) {
      return {
        descriptor,
        getBindGroupLayout(group) { return { group }; },
      };
    },
    async createRenderPipelineAsync(descriptor) {
      return {
        descriptor,
        getBindGroupLayout(group) { return { group }; },
      };
    },
    createBindGroup(descriptor) {
      for (const entry of descriptor.entries) {
        if (entry.resource?.buffer && entry.resource.size === 32) {
          assert.equal(entry.resource.offset % 256, 0);
        }
        if (entry.resource?.buffer && entry.resource.size === 256) {
          assert.equal(entry.resource.offset % 256, 0);
        }
      }
      return { descriptor };
    },
    createCommandEncoder() {
      return {
        beginComputePass() { calls.push(["compute"]); return computePass(); },
        beginRenderPass() { calls.push(["render"]); return renderPass(); },
        copyTextureToBuffer(_source, destination, extent) {
          calls.push(["copyCapture", destination.bytesPerRow, extent.width, extent.height]);
        },
        finish() { calls.push(["finish"]); return { command: true }; },
      };
    },
  };
  return { device, calls };
}

test("real gallery compiled plan executes without the legacy JavaScript renderer", async () => {
  const wasmManifest = JSON.parse(readFileSync(
    path.join(gallery, "wasm-manifest.json"),
    "utf8",
  ));
  const webGpuManifest = JSON.parse(readFileSync(
    path.join(gallery, "webgpu-manifest.json"),
    "utf8",
  ));
  const runtime = bridge.instantiateWasmRuntime({
    bytes: readFileSync(path.join(gallery, "app.wasm")),
    manifest: wasmManifest,
  });
  runtime.init();
  const { device, calls } = fakeGpu();
  const prepared = await adapter.prepare({
    device,
    format: "bgra8unorm",
    width: 1280,
    height: 720,
    gpuBufferUsage: {
      COPY_DST: 1,
      COPY_SRC: 2,
      MAP_READ: 128,
      VERTEX: 4,
      INDEX: 8,
      STORAGE: 16,
      UNIFORM: 32,
      INDIRECT: 64,
    },
    gpuTextureUsage: { RENDER_ATTACHMENT: 1, TEXTURE_BINDING: 2 },
    gpuMapMode: { READ: 1 },
    artifacts: {
      arena: runtime.retainedSceneArena(),
      parameters: runtime.renderParameterArena(),
      render: bridge.createWebGpuRuntimeSpec({
        manifest: webGpuManifest,
        wgsl: readFileSync(path.join(gallery, "app.wgsl"), "utf8"),
      }),
    },
  });
  prepared.context = {
    getCurrentTexture() {
      return { createView() { return { swapChain: true }; } };
    },
  };
  prepared.canvas = { width: 1280, height: 720 };
  adapter.submitFrame(prepared);

  assert.equal(
    calls.filter(([kind]) => kind === "compute").length,
    prepared.plan.passes.filter(({ dispatch }) => dispatch).length,
  );
  const initialTargetClears = prepared.plan.targets.filter(
    ({ initial_clear_value: clear }) => Array.isArray(clear),
  ).length;
  const renderRoots = prepared.plan.passes.filter(({ kind }) =>
    kind === "shadow_depth" ||
    kind === "planar_reflection" ||
    kind === "scene_color" ||
    kind === "scene_present",
  );
  const shadowPasses = renderRoots.filter(({ kind }) => kind === "shadow_depth");
  const shadowOwners = [
    ...prepared.plan.emitter_sources,
    ...prepared.plan.emitter_views,
  ].filter(({ casts_shadow: castsShadow }) => castsShadow);
  assert.deepEqual(
    shadowPasses.map(({ light_id: lightId }) => lightId),
    shadowOwners.map(({ id }) => id),
    "every direct or virtual shadow-casting emitter must own exactly one depth pass",
  );
  assert.equal(
    new Set(shadowPasses.map(({ light_index: lightIndex }) => lightIndex)).size,
    shadowPasses.length,
    "direct and virtual shadow contributions must retain distinct light ownership",
  );
  assert.deepEqual(
    shadowPasses.map(({ target_layer: targetLayer }) => targetLayer),
    shadowPasses.map((_, index) => index),
    "every shadow owner must retain a distinct depth-array layer",
  );
  assert.equal(
    prepared.plan.targets.find(({ id }) => id === "shadow_depth").array_layers,
    shadowPasses.length,
  );
  assert.equal(
    renderRoots.filter(({ kind }) => kind === "planar_reflection").length,
    4,
  );
  assert.equal(
    renderRoots.filter(({ kind }) => kind === "scene_color").length,
    1,
  );
  assert.equal(
    renderRoots.filter(({ kind }) => kind === "scene_present").length,
    1,
  );
  assert.equal(
    calls.filter(([kind]) => kind === "render").length,
    initialTargetClears + renderRoots.length,
    "the gallery must encode every root render pass and declared target clear",
  );
  const drawLists = runtime.renderParameterArena().descriptor.draw_lists;
  const expectedDrawCount = prepared.plan.passes
    .filter(({ draw_list_id }) => draw_list_id)
    .reduce((count, pass) => count + drawLists.find(
      ({ id }) => id === pass.draw_list_id,
    ).entries.length, 0);
  assert.ok(expectedDrawCount > 0);
  assert.equal(
    calls.filter(([kind]) => kind === "drawIndexed").length,
    expectedDrawCount,
  );
  assert.equal(
    calls.filter(([kind]) => kind === "draw").length,
    prepared.plan.passes.filter(({ vertex_count }) => vertex_count != null).length,
  );
  assert.deepEqual(calls.slice(-2), [["finish"], ["submit", 1]]);

  const captured = await adapter.captureFrame(prepared);
  assert.deepEqual(Array.from(captured.shape), [720, 1280, 4]);
  assert.equal(captured.dtype, "int");
  assert.deepEqual(Array.from(captured.subarray(0, 4)), [87, 87, 87, 255]);
  assert.deepEqual(
    calls.find(([kind]) => kind === "copyCapture"),
    ["copyCapture", 5120, 1280, 720],
    "the exact compiled gallery plan must capture its resolved frame offscreen",
  );
});
