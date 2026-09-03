const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const adapter = require("../../web/vf-ui/vf-compiled-webgpu-adapter.js");
const adapterSource = readFileSync(
  path.join(__dirname, "../../web/vf-ui/vf-compiled-webgpu-adapter.js"),
  "utf8",
);

test("compiled adapter reports uncaptured WebGPU validation errors to the native VKF log", () => {
  assert.match(adapterSource, /addEventListener\("uncapturederror"/u);
  assert.match(adapterSource, /type:\s*"vf_log"/u);
  assert.match(
    adapterSource,
    /addEventListener\("uncapturederror"[\s\S]*postRuntimeError\("webgpu-validation"/u,
  );
  assert.match(adapterSource, /source:\s*String\(source\)/u);
  assert.match(adapterSource, /level:\s*"error"/u);
});

test("compiled Layer time plays live, pauses, and resets without a GPU backlog", async () => {
  const animationFrames = [];
  const completions = [];
  const submissions = [];
  const controls = new Map();
  const control = () => ({
    textContent: "",
    attributes: new Map(),
    listeners: new Map(),
    addEventListener(name, listener) { this.listeners.set(name, listener); },
    removeEventListener(name) { this.listeners.delete(name); },
    setAttribute(name, value) { this.attributes.set(name, String(value)); },
  });
  controls.set("[data-vf-playback-toggle]", control());
  controls.set("[data-vf-playback-reset]", control());
  const objects = { buffer: {}, bytes: Uint8Array.from([10, 20]) };
  const lights = { buffer: {}, bytes: Uint8Array.from([30, 40]) };
  const prepared = {
    device: { queue: {
      onSubmittedWorkDone() {
        return new Promise((resolve) => completions.push(resolve));
      },
    } },
    parameterBuffers: new Map([["objects", objects], ["lights", lights]]),
  };
  let updates = 0;
  let resets = 0;
  const originalSubmitFrame = adapter.submitFrame;
  adapter.submitFrame = (_prepared, options) => submissions.push(options);
  try {
    const playback = adapter.attachTemporalPlayback({
      prepared,
      artifacts: { wasm: {
        manifest: { runtime_surface: { temporal_playback: {
          schema: "vektor-flow/layer-time-playback",
          version: 1,
          changed_parameter_sections: ["objects", "lights"],
        } } },
        update() {
          updates += 1;
          objects.bytes[0] += 1;
          lights.bytes[0] += 1;
        },
        init() { resets += 1; },
      } },
      document: { querySelector(selector) { return controls.get(selector) || null; } },
      requestAnimationFrame(callback) {
        animationFrames.push(callback);
        return animationFrames.length;
      },
      cancelAnimationFrame() {},
    });
    const toggle = controls.get("[data-vf-playback-toggle]");
    const reset = controls.get("[data-vf-playback-reset]");
    assert.equal(toggle.textContent, "Pause");
    assert.equal(toggle.attributes.get("aria-pressed"), "true");

    animationFrames.shift()(16.67);
    assert.equal(updates, 1);
    assert.equal(submissions.length, 1);
    assert.deepEqual(submissions[0].changedParameterSections, ["objects", "lights"]);
    animationFrames.shift()(33.34);
    assert.equal(updates, 1, "display ticks must not queue animation work behind the GPU");
    completions.shift()();
    await Promise.resolve();
    await Promise.resolve();
    animationFrames.shift()(50.01);
    assert.equal(updates, 2);

    toggle.listeners.get("click")();
    assert.equal(toggle.textContent, "Play");
    assert.equal(toggle.attributes.get("aria-pressed"), "false");
    completions.shift()();
    await Promise.resolve();
    animationFrames.shift()(66.68);
    assert.equal(updates, 2);

    reset.listeners.get("click")();
    assert.equal(resets, 1);
    assert.deepEqual([...objects.bytes], [10, 20]);
    assert.deepEqual([...lights.bytes], [30, 40]);
    assert.equal(submissions.length, 3, "reset must present the authored first sample");
    assert.equal(toggle.textContent, "Play", "reset must preserve the paused state");

    toggle.listeners.get("click")();
    assert.equal(toggle.textContent, "Pause");
    playback.dispose();
  } finally {
    adapter.submitFrame = originalSubmitFrame;
  }
});

function fixture() {
  const calls = [];
  const pipelineResolutionSnapshots = [];
  const pipelineLaunchCount = () => calls.filter((call) =>
    call.kind === "createRenderPipelineAsync" ||
    call.kind === "createComputePipelineAsync").length;
  const device = {
    queue: {
      writeBuffer(buffer, offset, bytes) {
        calls.push({ kind: "writeBuffer", buffer, offset, bytes });
      },
    },
    createBuffer(descriptor) {
      const buffer = { descriptor };
      calls.push({ kind: "createBuffer", descriptor, buffer });
      return buffer;
    },
    createShaderModule(descriptor) {
      const module = { descriptor };
      calls.push({ kind: "createShaderModule", descriptor, module });
      return module;
    },
    createTexture(descriptor) {
      const texture = {
        descriptor,
        createView() { return { texture }; },
      };
      calls.push({ kind: "createTexture", descriptor, texture });
      return texture;
    },
    createSampler(descriptor) {
      const sampler = { descriptor };
      calls.push({ kind: "createSampler", descriptor, sampler });
      return sampler;
    },
    async createRenderPipelineAsync(descriptor) {
      const pipeline = { descriptor };
      calls.push({ kind: "createRenderPipelineAsync", descriptor, pipeline });
      await Promise.resolve();
      pipelineResolutionSnapshots.push(pipelineLaunchCount());
      return pipeline;
    },
    async createComputePipelineAsync(descriptor) {
      const pipeline = { descriptor };
      calls.push({ kind: "createComputePipelineAsync", descriptor, pipeline });
      await Promise.resolve();
      pipelineResolutionSnapshots.push(pipelineLaunchCount());
      return pipeline;
    },
  };
  return { device, calls, pipelineResolutionSnapshots };
}

test("compiled adapter uploads the WASM arena once and creates only compiler-declared pipelines", async () => {
  globalThis.__vfStartupTimeline = [];
  const { device, calls, pipelineResolutionSnapshots } = fixture();
  const wasmMemory = new WebAssembly.Memory({ initial: 1 });
  const bytes = new Uint8Array(wasmMemory.buffer, 256, 160);
  const parameterBytes = new Uint8Array(wasmMemory.buffer, 1024, 288);
  bytes[0] = 23;
  const prepared = await adapter.prepare({
    device,
    format: "bgra8unorm",
    width: 1280,
    height: 720,
    gpuBufferUsage: { COPY_DST: 1, VERTEX: 2, INDEX: 4, STORAGE: 8, UNIFORM: 16 },
    gpuTextureUsage: { RENDER_ATTACHMENT: 1, TEXTURE_BINDING: 2 },
    artifacts: {
      arena: { bytes },
      parameters: {
        bytes: parameterBytes,
        descriptor: {
          schema: "vektor-flow/render-parameter-arena",
          version: 1,
          sections: [
            { name: "camera", byte_offset: 0, byte_length: 64 },
            { name: "lights", byte_offset: 64, byte_length: 80 },
            { name: "objects", byte_offset: 144, byte_length: 144 },
          ],
          draw_lists: [],
        },
      },
      render: {
        kind: "retained_scene_render",
        wgsl: "@vertex fn vkf_scene_vertex()->@builtin(position) vec4<f32>{return vec4<f32>();}",
        manifest: {
          runtime_surface: {
            render_plan: {
              schema: "vektor-flow/retained-scene-render-plan",
              version: 1,
              execution_owner: "wasm_wgsl",
              max_reflection_depth: 2,
              arena: {
                metadata_source: "wasm_retained_scene_arena",
                vertex_storage: "float32",
                index_storage: "uint32",
              },
              vertex_layout: {
                array_stride: 40,
                step_mode: "vertex",
                attributes: [
                  { shader_location: 0, offset: 0, format: "float32x3" },
                  { shader_location: 1, offset: 12, format: "float32x3" },
                  { shader_location: 2, offset: 24, format: "float32x4" },
                ],
              },
              bindings: [],
              samplers: [{
                id: "shadow_comparison_sampler",
                kind: "comparison",
                compare: "less",
                mag_filter: "linear",
                min_filter: "linear",
                mipmap_filter: "nearest",
                address_mode_u: "clamp-to-edge",
                address_mode_v: "clamp-to-edge",
                address_mode_w: "clamp-to-edge",
              }],
              derived_buffers: [{
                id: "derived_scene",
                byte_size: 512,
                usage: ["storage", "uniform"],
              }],
              control_buffers: [{
                id: "pass_state_arena",
                byte_size: 256,
                usage: ["uniform", "copy_dst"],
                fields: [
                  "camera_state_index:u32@0",
                  "reflection_depth:u32@4",
                ],
                records: [{
                  byte_offset: 0,
                  data: { camera_state_index: 7, reflection_depth: 2 },
                }],
              }, {
                id: "platform_viewport",
                byte_size: 8,
                usage: ["uniform", "copy_dst"],
              }],
              targets: [{
                id: "surface",
                kind: "color",
                format: "rgba16float",
                size_policy: "canvas_scale",
                scale: 0.5,
                sample_count: 4,
              }],
              pipelines: [{
                id: "prepare_frame",
                compute_entry: "vkf_prepare_frame",
              }, {
                id: "scene",
                vertex_entry: "vkf_scene_vertex",
                fragment_entry: "vkf_scene_fragment",
                topology: "triangle-list",
                depth_write: true,
                color_target: "surface",
                color_format: "rgba16float",
                depth_format: "depth32float",
                depth_bias: 2,
                depth_bias_slope_scale: 2,
                sample_count: 4,
              }],
              passes: [{
                kind: "scene_color",
                pipeline: "scene",
                target: "surface",
                color_attachment: "surface",
              }],
              features: {
                checker_texture: true,
                planar_mirror: true,
                shadow_map: true,
              },
            },
          },
        },
      },
    },
  });

  assert.equal(prepared.arenaBytes, bytes);
  assert.equal(prepared.arenaBytes.buffer, wasmMemory.buffer);
  assert.equal(prepared.parameterBytes, parameterBytes);
  assert.equal(prepared.parameterBytes.buffer, wasmMemory.buffer);
  assert.equal(prepared.pipelines.size, 2);
  assert.equal(prepared.targets.size, 1);
  assert.equal(prepared.samplers.size, 1);
  assert.equal(
    prepared.samplers.get("shadow_comparison_sampler").descriptor.compare,
    "less",
  );
  assert.equal(prepared.resourceBuffers.size, 3);
  assert.equal(prepared.resourceBuffers.get("derived_scene").descriptor.size, 512);
  assert.equal(prepared.targets.get("surface").texture.descriptor.size.width, 640);
  assert.equal(prepared.targets.get("surface").texture.descriptor.size.height, 360);
  assert.equal(prepared.targets.get("surface").texture.descriptor.sampleCount, 4);
  const writes = calls.filter((call) => call.kind === "writeBuffer");
  assert.equal(writes.length, 6);
  assert.equal(writes[0].bytes, bytes, "GPU upload must read the WASM view directly");
  assert.equal(writes[1].bytes.buffer, parameterBytes.buffer);
  assert.equal(writes[2].bytes.buffer, parameterBytes.buffer);
  assert.equal(writes[3].bytes.buffer, parameterBytes.buffer);
  assert.deepEqual(Array.from(writes[4].bytes), [1280, 720]);
  const passState = new DataView(
    writes[5].bytes.buffer,
    writes[5].bytes.byteOffset,
    writes[5].bytes.byteLength,
  );
  assert.equal(passState.getUint32(0, true), 7);
  assert.equal(passState.getUint32(4, true), 2);
  const pipelineCalls = calls.filter((call) => call.kind === "createRenderPipelineAsync");
  assert.equal(pipelineCalls.length, 1);
  assert.equal(pipelineCalls[0].descriptor.vertex.buffers[0].arrayStride, 40);
  assert.equal(pipelineCalls[0].descriptor.vertex.entryPoint, "vkf_scene_vertex");
  assert.equal(pipelineCalls[0].descriptor.fragment.entryPoint, "vkf_scene_fragment");
  assert.equal(pipelineCalls[0].descriptor.fragment.targets[0].format, "rgba16float");
  assert.equal(pipelineCalls[0].descriptor.multisample.count, 4);
  assert.equal(pipelineCalls[0].descriptor.depthStencil.format, "depth32float");
  assert.equal(pipelineCalls[0].descriptor.depthStencil.depthBias, 2);
  assert.equal(pipelineCalls[0].descriptor.depthStencil.depthBiasSlopeScale, 2);
  const computeCalls = calls.filter((call) => call.kind === "createComputePipelineAsync");
  assert.equal(computeCalls.length, 1);
  assert.equal(computeCalls[0].descriptor.compute.entryPoint, "vkf_prepare_frame");
  assert.deepEqual(
    pipelineResolutionSnapshots,
    [2, 2],
    "every async factory must launch before the first pipeline can resolve",
  );
  assert.deepEqual(
    globalThis.__vfStartupTimeline.map(({ name }) => name),
    [
      "compiled-gpu:prepare:start",
      "compiled-gpu:arena-uploaded",
      "compiled-gpu:shader-module-created",
      "compiled-gpu:pipelines:start",
      "compiled-gpu:pipeline:ready",
      "compiled-gpu:pipeline:ready",
      "compiled-gpu:pipelines:ready",
    ],
  );
  delete globalThis.__vfStartupTimeline;
});

test("compiled adapter rejects JavaScript-owned or unversioned render plans", async () => {
  await assert.rejects(
    adapter.prepare({
      device: fixture().device,
      gpuBufferUsage: { COPY_DST: 1, VERTEX: 2, INDEX: 4, STORAGE: 8 },
      artifacts: {
        arena: { bytes: new Uint8Array(4) },
        render: {
          kind: "retained_scene_render",
          wgsl: "shader",
          manifest: {
            runtime_surface: {
              render_plan: {
                schema: "vektor-flow/retained-scene-render-plan",
                version: 1,
                execution_owner: "javascript",
              },
            },
          },
        },
      },
    }),
    /execution_owner/,
  );
});

test("compiled adapter owns only WebGPU acquisition and canvas presentation setup", async () => {
  globalThis.__vfStartupTimeline = [];
  const requested = [];
  const lifecycle = [];
  const mountDevice = fixture().device;
  mountDevice.queue.onSubmittedWorkDone = async () => {
    lifecycle.push("work-done");
  };
  const canvas = {
    width: 640,
    height: 360,
    getContext(kind) {
      assert.equal(kind, "webgpu");
      return {
        configure(descriptor) { requested.push(descriptor); },
      };
    },
  };
  const navigator = {
    gpu: {
      getPreferredCanvasFormat() { return "bgra8unorm"; },
      async requestAdapter() {
        requested.push("adapter");
        return {
          async requestDevice() {
            requested.push("device");
            return mountDevice;
          },
        };
      },
    },
  };
  const originalPrepare = adapter.prepare;
  const originalSubmitFrame = adapter.submitFrame;
  let received = null;
  let submitted = null;
  adapter.prepare = async (options) => {
    received = options;
    return { plan: { passes: [] } };
  };
  adapter.submitFrame = (prepared) => { submitted = prepared; };
  try {
    await adapter.prime({ navigator });
    const mounted = await adapter.mount({
      canvas,
      navigator,
      gpuTextureUsage: { RENDER_ATTACHMENT: 4, COPY_SRC: 8 },
      artifacts: { render: { kind: "retained_scene_render" } },
      onSubmitted() { lifecycle.push("submitted"); },
      onPresented() { lifecycle.push("presented"); },
    });
    assert.equal(received.canvas, canvas);
    assert.equal(received.width, 640);
    assert.equal(received.height, 360);
    assert.equal(received.format, "bgra8unorm");
    assert.deepEqual(requested.slice(0, 2), ["adapter", "device"]);
    assert.equal(requested.length, 3);
    assert.equal(requested[2].format, "bgra8unorm");
    assert.equal(requested[2].alphaMode, "premultiplied");
    assert.equal(requested[2].usage, 12,
      "compiled canvas textures must support Frame.capture readback");
    assert.equal(mounted.canvas, canvas);
    assert.equal(submitted, mounted);
    assert.equal(mounted.presented, true);
    assert.deepEqual(lifecycle, ["submitted", "work-done", "presented"]);
    assert.deepEqual(
      globalThis.__vfStartupTimeline.map(({ name }) => name),
      [
        "compiled-gpu:adapter-request:start",
        "compiled-gpu:adapter-request:ready",
        "compiled-gpu:device-request:start",
        "compiled-gpu:device-request:ready",
      ],
    );
  } finally {
    delete globalThis.__vfStartupTimeline;
    adapter.prepare = originalPrepare;
    adapter.submitFrame = originalSubmitFrame;
  }
});

test("compiled adapter never presents a WebGPU validation-rejected first frame", async () => {
  const mountDevice = fixture().device;
  const validationError = { message: "missing pass-state binding 6" };
  const lifecycle = [];
  mountDevice.pushErrorScope = (kind) => lifecycle.push(["push", kind]);
  mountDevice.popErrorScope = async () => {
    lifecycle.push(["pop"]);
    return validationError;
  };
  mountDevice.queue.onSubmittedWorkDone = async () => {
    lifecycle.push(["work-done"]);
  };
  const canvas = {
    width: 640,
    height: 360,
    getContext() {
      return { configure() {} };
    },
  };
  const navigator = { gpu: {
    getPreferredCanvasFormat() { return "bgra8unorm"; },
    async requestAdapter() {
      return { async requestDevice() { return mountDevice; } };
    },
  } };
  const originalPrepare = adapter.prepare;
  const originalSubmitFrame = adapter.submitFrame;
  adapter.prepare = async () => ({ plan: { passes: [] } });
  adapter.submitFrame = () => { lifecycle.push(["submitted"]); };
  try {
    await assert.rejects(
      adapter.mount({
        canvas,
        navigator,
        gpuTextureUsage: { RENDER_ATTACHMENT: 4, COPY_SRC: 8 },
        artifacts: { render: { kind: "retained_scene_render" } },
        onPresented() { lifecycle.push(["presented"]); },
      }),
      /first frame.*missing pass-state binding 6/iu,
    );
    assert.deepEqual(lifecycle, [
      ["push", "validation"],
      ["submitted"],
      ["pop"],
      ["work-done"],
    ]);
  } finally {
    adapter.prepare = originalPrepare;
    adapter.submitFrame = originalSubmitFrame;
  }
});

test("opt-in hidden benchmark reports real sequential queue completions", async () => {
  const mountDevice = fixture().device;
  let queueCompletions = 0;
  mountDevice.queue.onSubmittedWorkDone = async () => {
    queueCompletions += 1;
  };
  const posted = [];
  const cameraCalls = [];
  const submissions = [];
  const cameraBytes = new Uint8Array(96);
  const originalPrepare = adapter.prepare;
  const originalSubmitFrame = adapter.submitFrame;
  const originalCaptureFrame = adapter.captureFrame;
  let captureCalls = 0;
  const originalChrome = globalThis.chrome;
  globalThis.__vfOffscreenCameraBenchmark = {
    sampleCount: 5,
    warmupCount: 1,
  };
  globalThis.chrome = { webview: {
    postMessage(message) { posted.push(message); },
  } };
  adapter.prepare = async () => ({
    plan: { passes: [{ kind: "scene_color" }] },
    resourceBuffers: new Map(),
    parameterBuffers: new Map([["camera", {
      buffer: { id: "camera" },
      bytes: cameraBytes,
      byteLength: cameraBytes.byteLength,
    }]]),
  });
  adapter.submitFrame = (_prepared, options) => {
    submissions.push(options || null);
  };
  adapter.captureFrame = async () => {
    captureCalls += 1;
    const image = new Int32Array([
      10, 20, 30, 255,
      10, 20, 30, 255,
      80, 90, 100, 255,
      10, 20, 30, 255,
    ]);
    Object.defineProperty(image, "shape", { value: [2, 2, 4] });
    return image;
  };
  try {
    const canvas = {
      width: 1784,
      height: 995,
      addEventListener() {},
      removeEventListener() {},
      focus() {},
      getContext() {
        return { configure() {} };
      },
    };
    await adapter.mount({
      canvas,
      navigator: { gpu: {
        getPreferredCanvasFormat() { return "bgra8unorm"; },
        async requestAdapter() {
          return { async requestDevice() { return mountDevice; } };
        },
      } },
      gpuTextureUsage: { RENDER_ATTACHMENT: 4, COPY_SRC: 8 },
      artifacts: {
        render: { kind: "retained_scene_render" },
        wasm: {
          cameraControl(horizontal, vertical, zoom) {
            cameraCalls.push([horizontal, vertical, zoom]);
          },
        },
      },
      config: { scene_ir: { camera: { properties: {
        controls_mode: "orbit",
      } } } },
    });
    assert.equal(posted.length, 1);
    assert.equal(posted[0].type, "vf_offscreen_camera_benchmark_v1");
    assert.equal(posted[0].schema,
      "vektor-flow/compiled-camera-gpu-benchmark-v1");
    assert.deepEqual(posted[0].resolution, { width: 1784, height: 995 });
    assert.equal(posted[0].sample_count, 5);
    assert.equal(posted[0].samples.length, 5);
    assert.equal(captureCalls, 1,
      "the benchmark must validate its initial frame through Frame.capture");
    assert.deepEqual(posted[0].capture, {
      width: 2,
      height: 2,
      channel_min: [10, 20, 30, 255],
      channel_max: [80, 90, 100, 255],
      background_rgba: [10, 20, 30, 255],
      non_background_pixel_count: 1,
      checksum: "fnv1a32:d8228cc3",
      spatial_tiles: {
        columns: 2,
        rows: 2,
        tiles: [
          { pixel_count: 1, rgb_sum: [10, 20, 30] },
          { pixel_count: 1, rgb_sum: [10, 20, 30] },
          { pixel_count: 1, rgb_sum: [80, 90, 100] },
          { pixel_count: 1, rgb_sum: [10, 20, 30] },
        ],
      },
    });
    assert.equal(Number.isFinite(posted[0].p50_input_to_queue_done_ms), true);
    assert.equal(Number.isFinite(posted[0].p95_input_to_queue_done_ms), true);
    assert.equal(Number.isFinite(posted[0].p50_submit_to_queue_done_ms), true);
    assert.equal(Number.isFinite(posted[0].p95_submit_to_queue_done_ms), true);
    assert.equal(cameraCalls.length, 6, "one warmup plus five measured inputs");
    assert.equal(submissions.length, 7, "initial presentation plus six benchmark frames");
    assert.equal(queueCompletions, 7,
      "every submitted frame must reach actual queue completion sequentially");
    assert.equal(submissions.slice(1).every((value) =>
      value && value.reuseStaticShadows === true), true);
  } finally {
    adapter.prepare = originalPrepare;
    adapter.submitFrame = originalSubmitFrame;
    adapter.captureFrame = originalCaptureFrame;
    delete globalThis.__vfOffscreenCameraBenchmark;
    if (originalChrome === undefined) delete globalThis.chrome;
    else globalThis.chrome = originalChrome;
  }
});

test("opt-in hidden benchmark rejects a uniform captured frame before timing", async () => {
  const mountDevice = fixture().device;
  mountDevice.queue.onSubmittedWorkDone = async () => {};
  const posted = [];
  const cameraCalls = [];
  const submissions = [];
  const originalPrepare = adapter.prepare;
  const originalSubmitFrame = adapter.submitFrame;
  const originalCaptureFrame = adapter.captureFrame;
  const originalChrome = globalThis.chrome;
  globalThis.__vfOffscreenCameraBenchmark = { sampleCount: 5, warmupCount: 1 };
  globalThis.chrome = { webview: {
    postMessage(message) { posted.push(message); },
  } };
  adapter.prepare = async () => ({
    plan: { passes: [{ kind: "scene_color" }] },
    resourceBuffers: new Map(),
    parameterBuffers: new Map([["camera", {
      buffer: { id: "camera" },
      bytes: new Uint8Array(96),
    }]]),
  });
  adapter.submitFrame = (_prepared, options) => submissions.push(options || null);
  adapter.captureFrame = async () => {
    const image = new Int32Array(4 * 3 * 4).fill(17);
    Object.defineProperty(image, "shape", { value: [3, 4, 4] });
    return image;
  };
  try {
    const canvas = {
      width: 1784,
      height: 995,
      addEventListener() {},
      removeEventListener() {},
      focus() {},
      getContext() { return { configure() {} }; },
    };
    await adapter.mount({
      canvas,
      navigator: { gpu: {
        getPreferredCanvasFormat() { return "bgra8unorm"; },
        async requestAdapter() {
          return { async requestDevice() { return mountDevice; } };
        },
      } },
      gpuTextureUsage: { RENDER_ATTACHMENT: 4, COPY_SRC: 8 },
      artifacts: {
        render: { kind: "retained_scene_render" },
        wasm: { cameraControl(...args) { cameraCalls.push(args); } },
      },
      config: { scene_ir: { camera: { properties: { controls_mode: "orbit" } } } },
    });
    assert.equal(posted.length, 1);
    assert.equal(posted[0].status, "error");
    assert.match(posted[0].error, /uniform or empty/u);
    assert.deepEqual(posted[0].capture, {
      width: 4,
      height: 3,
      channel_min: [17, 17, 17, 17],
      channel_max: [17, 17, 17, 17],
      background_rgba: [17, 17, 17, 17],
      non_background_pixel_count: 0,
      checksum: "fnv1a32:27511755",
      spatial_tiles: {
        columns: 4,
        rows: 3,
        tiles: Array.from({ length: 12 }, () => ({
          pixel_count: 1,
          rgb_sum: [17, 17, 17],
        })),
      },
    });
    assert.equal(cameraCalls.length, 0,
      "invalid pixels must reject the benchmark before timing camera frames");
    assert.equal(submissions.length, 1, "only the initial mount frame may submit");
  } finally {
    adapter.prepare = originalPrepare;
    adapter.submitFrame = originalSubmitFrame;
    adapter.captureFrame = originalCaptureFrame;
    delete globalThis.__vfOffscreenCameraBenchmark;
    if (originalChrome === undefined) delete globalThis.chrome;
    else globalThis.chrome = originalChrome;
  }
});

test("opt-in native media capture returns two frame-internal RGBA states", async () => {
  const mountDevice = fixture().device;
  let queueCompletions = 0;
  mountDevice.queue.onSubmittedWorkDone = async () => { queueCompletions += 1; };
  const posted = [];
  const cameraCalls = [];
  const submissions = [];
  const cameraBytes = new Uint8Array(96);
  const originalPrepare = adapter.prepare;
  const originalSubmitFrame = adapter.submitFrame;
  const originalCaptureFrame = adapter.captureFrame;
  const originalChrome = globalThis.chrome;
  globalThis.__vfNativeFrameMediaCapture = Object.freeze({
    states: ["camera-default", "camera-wheel-detail"],
  });
  globalThis.chrome = { webview: {
    postMessage(message) { posted.push(message); },
  } };
  adapter.prepare = async () => ({
    plan: { passes: [{ kind: "scene_color" }] },
    resourceBuffers: new Map(),
    parameterBuffers: new Map([["camera", {
      buffer: { id: "camera" },
      bytes: cameraBytes,
      byteLength: cameraBytes.byteLength,
    }]]),
  });
  adapter.submitFrame = (_prepared, options) => submissions.push(options || null);
  let captureIndex = 0;
  adapter.captureFrame = async () => {
    const pixels = captureIndex++ === 0
      ? [10, 20, 30, 255, 40, 50, 60, 255]
      : [70, 80, 90, 255, 100, 110, 120, 255];
    const image = new Int32Array(pixels);
    Object.defineProperty(image, "shape", { value: [1, 2, 4] });
    return image;
  };
  try {
    const canvas = {
      width: 1784,
      height: 995,
      addEventListener() {},
      removeEventListener() {},
      focus() {},
      getContext() { return { configure() {} }; },
    };
    await adapter.mount({
      canvas,
      navigator: { gpu: {
        getPreferredCanvasFormat() { return "bgra8unorm"; },
        async requestAdapter() {
          return { async requestDevice() { return mountDevice; } };
        },
      } },
      gpuTextureUsage: { RENDER_ATTACHMENT: 4, COPY_SRC: 8 },
      artifacts: {
        render: { kind: "retained_scene_render" },
        wasm: { cameraControl(...args) { cameraCalls.push(args); } },
      },
      config: { scene_ir: { camera: { properties: { controls_mode: "orbit" } } } },
    });
    assert.equal(posted.length, 1);
    assert.equal(posted[0].type, "vf_native_frame_media_capture_v1");
    assert.equal(posted[0].schema, "vektor-flow/native-frame-media-capture-v1");
    assert.equal(posted[0].status, "ok");
    assert.equal(posted[0].capture_api, "Frame.capture");
    assert.equal(posted[0].boundary, "frame-internal");
    assert.deepEqual(posted[0].states, [
      {
        view: "camera-default",
        width: 2,
        height: 1,
        rgba_base64: Buffer.from([10, 20, 30, 255, 40, 50, 60, 255]).toString("base64"),
        checksum: "fnv1a32:a5d4932b",
      },
      {
        view: "camera-wheel-detail",
        width: 2,
        height: 1,
        rgba_base64: Buffer.from([70, 80, 90, 255, 100, 110, 120, 255]).toString("base64"),
        checksum: "fnv1a32:c9190e1b",
      },
    ]);
    assert.deepEqual(cameraCalls, [[0, 0, -1]]);
    assert.equal(submissions.length, 2, "initial and detail camera frames submit");
    assert.equal(queueCompletions, 2, "both frame states reach GPU completion");
  } finally {
    adapter.prepare = originalPrepare;
    adapter.submitFrame = originalSubmitFrame;
    adapter.captureFrame = originalCaptureFrame;
    delete globalThis.__vfNativeFrameMediaCapture;
    if (originalChrome === undefined) delete globalThis.chrome;
    else globalThis.chrome = originalChrome;
  }
});

test("time media capture uploads every compiler-declared parameter section", async () => {
  const mountDevice = fixture().device;
  mountDevice.queue.onSubmittedWorkDone = async () => {};
  const submissions = [];
  const originalPrepare = adapter.prepare;
  const originalSubmitFrame = adapter.submitFrame;
  const originalCaptureFrame = adapter.captureFrame;
  const originalChrome = globalThis.chrome;
  globalThis.__vfNativeFrameMediaCapture = Object.freeze({
    mode: "time",
    frameCount: 2,
  });
  globalThis.chrome = { webview: { postMessage() {} } };
  adapter.prepare = async () => ({
    plan: { passes: [{ kind: "scene_color" }] },
    resourceBuffers: new Map(),
    parameterBuffers: new Map([["camera", {
      buffer: { id: "camera" },
      bytes: new Uint8Array(96),
      byteLength: 96,
    }]]),
  });
  adapter.submitFrame = (_prepared, options) => submissions.push(options || null);
  adapter.captureFrame = async () => {
    const image = new Int32Array([10, 20, 30, 255]);
    Object.defineProperty(image, "shape", { value: [1, 1, 4] });
    return image;
  };
  try {
    await adapter.mount({
      canvas: {
        width: 1784,
        height: 995,
        addEventListener() {},
        removeEventListener() {},
        focus() {},
        getContext() { return { configure() {} }; },
      },
      navigator: { gpu: {
        getPreferredCanvasFormat() { return "bgra8unorm"; },
        async requestAdapter() {
          return { async requestDevice() { return mountDevice; } };
        },
      } },
      gpuTextureUsage: { RENDER_ATTACHMENT: 4, COPY_SRC: 8 },
      artifacts: { wasm: {
        manifest: { runtime_surface: { temporal_playback: {
          schema: "vektor-flow/layer-time-playback",
          version: 1,
          changed_parameter_sections: ["camera", "objects", "lights"],
        } } },
        cameraControl() {},
        update() {},
      } },
      config: { scene_ir: { camera: { properties: { controls_mode: "orbit" } } } },
    });
    assert.equal(submissions.length, 2, "initial and second time samples submit");
    assert.deepEqual(
      submissions[1].changedParameterSections,
      ["camera", "objects", "lights"],
      "capture must use the compiled dirty-section contract",
    );
  } finally {
    adapter.prepare = originalPrepare;
    adapter.submitFrame = originalSubmitFrame;
    adapter.captureFrame = originalCaptureFrame;
    delete globalThis.__vfNativeFrameMediaCapture;
    if (originalChrome === undefined) delete globalThis.chrome;
    else globalThis.chrome = originalChrome;
  }
});

test("compiled Frame.capture readback materializes aligned BGRA rows as RGBA ints", async () => {
  const width = 2;
  const height = 2;
  const bytesPerRow = 256;
  const mapped = new Uint8Array(bytesPerRow * height);
  mapped.set([30, 20, 10, 255, 60, 50, 40, 128], 0);
  mapped.set([90, 80, 70, 255, 120, 110, 100, 64], bytesPerRow);
  const calls = [];
  const readback = {
    async mapAsync(mode) { calls.push(["map", mode]); },
    getMappedRange() { return mapped.buffer; },
    unmap() { calls.push(["unmap"]); },
    destroy() { calls.push(["destroy"]); },
  };
  const texture = { createView() { return { texture }; } };
  const prepared = {
    canvas: { width, height },
    context: { getCurrentTexture() { return texture; } },
    format: "bgra8unorm",
    gpuBufferUsage: { COPY_DST: 2, MAP_READ: 4 },
    gpuMapMode: { READ: 8 },
    device: {
      createBuffer(descriptor) {
        calls.push(["buffer", descriptor]);
        return readback;
      },
      createCommandEncoder() {
        return {
          copyTextureToBuffer(source, destination, extent) {
            calls.push(["copy", source, destination, extent]);
          },
          finish() { return { command: true }; },
        };
      },
      queue: {
        submit() { calls.push(["submit"]); },
        async onSubmittedWorkDone() { calls.push(["done"]); },
      },
    },
    targets: new Map([[
      "swap_chain",
      { id: "swap_chain", kind: "external_color", width, height },
    ]]),
    pipelines: new Map(),
    plan: {
      targets: [{ id: "swap_chain", kind: "external_color" }],
      passes: [],
    },
  };

  const image = await adapter.captureFrame(prepared);
  assert.deepEqual(Array.from(image), [
    10, 20, 30, 255,
    40, 50, 60, 128,
    70, 80, 90, 255,
    100, 110, 120, 64,
  ]);
  assert.deepEqual(Array.from(image.shape), [height, width, 4]);
  assert.equal(image.dtype, "int");
  assert.equal(calls.find(([kind]) => kind === "buffer")[1].size, 512);
  const copy = calls.find(([kind]) => kind === "copy");
  assert.equal(copy[2].bytesPerRow, 256);
  assert.deepEqual(copy[3], { width, height, depthOrArrayLayers: 1 });
  assert.deepEqual(calls.slice(-4).map(([kind]) => kind), [
    "done", "map", "unmap", "destroy",
  ]);
});

test("compiled adapter updates only the camera arena for arrow orbit and wheel zoom", () => {
  assert.equal(typeof adapter.attachCameraControls, "function");
  const listeners = new Map();
  const windowListeners = new Map();
  const writes = [];
  const cameraCalls = [];
  const interactionBusy = [];
  let submissions = 0;
  const bytes = new Uint8Array(96);
  const view = new DataView(bytes.buffer);
  [0, -8.3, 4.6].forEach((value, index) => view.setFloat32(index * 4, value, true));
  [0, 0.45, 1.45].forEach((value, index) => view.setFloat32(12 + index * 4, value, true));
  [0, 0, 1].forEach((value, index) => view.setFloat32(24 + index * 4, value, true));
  const prepared = {
    temporalPlayback: {
      setInteractionBusy(busy) { interactionBusy.push(busy); },
    },
    device: {
      queue: {
        writeBuffer(buffer, offset, payload) { writes.push({ buffer, offset, payload: Uint8Array.from(payload) }); },
      },
    },
    parameterBuffers: new Map([["camera", {
      buffer: { id: "camera" },
      bytes,
      byteLength: 96,
      descriptor: {
        stride: 96,
        fields: [
          { name: "position", byte_offset: 0, components: 3 },
          { name: "target", byte_offset: 12, components: 3 },
          { name: "up", byte_offset: 24, components: 3 },
        ],
      },
    }]]),
  };
  const canvas = {
    tabIndex: -1,
    addEventListener(name, listener) { listeners.set(name, listener); },
    removeEventListener() {},
    focus() {},
  };
  const eventTarget = {
    addEventListener(name, listener) { windowListeners.set(name, listener); },
    removeEventListener() {},
  };
  const originalSubmitFrame = adapter.submitFrame;
  adapter.submitFrame = () => { submissions += 1; };
  try {
    adapter.attachCameraControls({
      prepared,
      artifacts: { wasm: {
        cameraControl(horizontal, vertical, zoom) {
          cameraCalls.push([horizontal, vertical, zoom]);
          if (zoom < 0) { view.setFloat32(4, -6.64, true); }
          if (horizontal > 0) { view.setFloat32(0, 1.0, true); }
        },
      } },
      canvas,
      eventTarget,
      requestAnimationFrame() { return 1; },
      cancelAnimationFrame() {},
      config: {
        scene_ir: {
          camera: { properties: { pos: [0, -8.3, 4.6], target: [0, 0.45, 1.45], up: [0, 0, 1], controls_mode: "orbit" } },
        },
      },
    });
    const initialDistance = Math.hypot(0, -8.75, 3.15);
    listeners.get("wheel")({ deltaY: -120, preventDefault() {} });
    const zoomed = [0, 1, 2].map((index) => view.getFloat32(index * 4, true));
    const zoomedDistance = Math.hypot(zoomed[0], zoomed[1] - 0.45, zoomed[2] - 1.45);
    assert.ok(zoomedDistance < initialDistance, "wheel-up must move the compiled camera closer");
    const beforeOrbit = zoomed.slice();
    windowListeners.get("keydown")({ key: "ArrowRight", repeat: false, preventDefault() {} });
    const orbited = [0, 1, 2].map((index) => view.getFloat32(index * 4, true));
    assert.notDeepEqual(orbited, beforeOrbit, "arrow key must rotate the compiled camera");
    windowListeners.get("keyup")({ key: "ArrowRight", preventDefault() {} });
    assert.equal(writes.length, 2);
    assert.equal(submissions, 2);
    assert.deepEqual(cameraCalls, [[0, 0, -1], [1, 0, 0]]);
    assert.equal(writes.every((write) => write.payload.byteLength === 96), true);
    assert.deepEqual(interactionBusy, [true, false, true, false],
      "camera work must pause temporal submissions until its GPU frame is released");
  } finally {
    adapter.submitFrame = originalSubmitFrame;
  }
});

test("compiled camera controls bound fresh input to one GPU frame", async () => {
  const listeners = new Map();
  const completions = [];
  let submissions = 0;
  const bytes = new Uint8Array(96);
  const prepared = {
    device: { queue: {
      writeBuffer() {},
      onSubmittedWorkDone() {
        return new Promise((resolve) => completions.push(resolve));
      },
    } },
    parameterBuffers: new Map([["camera", {
      buffer: {}, bytes, byteLength: 96,
      descriptor: { fields: [
        { name: "position", byte_offset: 0, components: 3 },
        { name: "target", byte_offset: 12, components: 3 },
        { name: "up", byte_offset: 24, components: 3 },
      ] },
    }]]),
  };
  const canvas = {
    tabIndex: 0,
    addEventListener(name, listener) { listeners.set(name, listener); },
    removeEventListener() {},
    focus() {},
  };
  const originalSubmitFrame = adapter.submitFrame;
  adapter.submitFrame = () => { submissions += 1; };
  try {
    const controller = adapter.attachCameraControls({
      prepared,
      artifacts: { wasm: { cameraControl() {} } },
      canvas,
      eventTarget: { addEventListener() {}, removeEventListener() {} },
      config: { scene_ir: { camera: { properties: {
        pos: [0, -8, 4], target: [0, 0, 1], up: [0, 0, 1],
        controls_mode: "orbit",
      } } } },
    });
    listeners.get("wheel")({ deltaY: -100, preventDefault() {} });
    listeners.get("wheel")({ deltaY: -100, preventDefault() {} });
    listeners.get("wheel")({ deltaY: -100, preventDefault() {} });
    assert.equal(submissions, 1,
      "fresh input must not queue redundant full-scene frames behind the GPU");
    assert.equal(completions.length, 1,
      "the submitted camera frame must own the single GPU slot");
    completions.shift()();
    await Promise.resolve();
    await Promise.resolve();
    listeners.get("wheel")({ deltaY: -100, preventDefault() {} });
    assert.equal(submissions, 2,
      "new input must submit immediately after the GPU slot becomes free");
    controller.dispose();
    await Promise.resolve();
    assert.equal(submissions, 2, "dispose must not enqueue camera work");
  } finally {
    adapter.submitFrame = originalSubmitFrame;
  }
});

test("compiled held arrows resume a missed display tick as soon as the GPU is free", async () => {
  const windowListeners = new Map();
  const animationFrames = [];
  const completions = [];
  const cameraCalls = [];
  let submissions = 0;
  const prepared = {
    device: { queue: {
      writeBuffer() {},
      onSubmittedWorkDone() {
        return new Promise((resolve) => completions.push(resolve));
      },
    } },
    parameterBuffers: new Map([["camera", {
      buffer: {}, bytes: new Uint8Array(96), byteLength: 96,
      descriptor: { fields: [
        { name: "position", byte_offset: 0, components: 3 },
        { name: "target", byte_offset: 12, components: 3 },
        { name: "up", byte_offset: 24, components: 3 },
      ] },
    }]]),
  };
  const canvas = {
    tabIndex: 0,
    addEventListener() {},
    removeEventListener() {},
    focus() {},
  };
  const originalSubmitFrame = adapter.submitFrame;
  adapter.submitFrame = () => { submissions += 1; };
  try {
    adapter.attachCameraControls({
      prepared,
      artifacts: { wasm: {
        cameraControl(horizontal, vertical, zoom) {
          cameraCalls.push([horizontal, vertical, zoom]);
          prepared.parameterBuffers.get("camera").bytes[0] += 1;
        },
      } },
      canvas,
      eventTarget: {
        addEventListener(name, listener) { windowListeners.set(name, listener); },
        removeEventListener() {},
      },
      requestAnimationFrame(callback) {
        animationFrames.push(callback);
        return animationFrames.length;
      },
      cancelAnimationFrame() {},
      config: { scene_ir: { camera: { properties: {
        pos: [0, -8, 4], target: [0, 0, 1], up: [0, 0, 1],
        controls_mode: "orbit",
      } } } },
    });
    windowListeners.get("keydown")({
      key: "ArrowRight", repeat: false, preventDefault() {},
    });
    assert.deepEqual(cameraCalls, [[1, 0, 0]]);
    assert.equal(submissions, 1);

    animationFrames.shift()(16.67);
    assert.deepEqual(cameraCalls, [[1, 0, 0]],
      "a busy display frame must not accumulate hidden movement");
    assert.equal(prepared.parameterBuffers.get("camera").bytes[0], 1);

    completions.shift()();
    await Promise.resolve();
    await Promise.resolve();
    assert.deepEqual(cameraCalls, [[1, 0, 0], [1, 0, 0]],
      "GPU completion must immediately service a display tick missed while busy");
    assert.equal(prepared.parameterBuffers.get("camera").bytes[0], 2);
    assert.equal(submissions, 2,
      "the missed display tick must render without waiting for another animation frame");

    animationFrames.shift()(33.34);
    assert.equal(submissions, 2,
      "the next display tick must not queue behind the resumed GPU frame");

    windowListeners.get("keyup")({ key: "ArrowRight", preventDefault() {} });
    assert.equal(prepared.parameterBuffers.get("camera").bytes[0], 2,
      "release must preserve the last visible camera without a backwards jump");
    const cancelledRace = animationFrames.shift();
    cancelledRace(50.01);
    assert.deepEqual(cameraCalls, [[1, 0, 0], [1, 0, 0]],
      "a callback racing with key release must observe that no key is held");
    assert.equal(submissions, 2,
      "release must stop without submitting buffered motion");
  } finally {
    adapter.submitFrame = originalSubmitFrame;
  }
});

test("compiled keydown during a busy camera frame resumes at GPU completion", async () => {
  const windowListeners = new Map();
  const animationFrames = [];
  const completions = [];
  const cameraCalls = [];
  let submissions = 0;
  const prepared = {
    device: { queue: {
      writeBuffer() {},
      onSubmittedWorkDone() {
        return new Promise((resolve) => completions.push(resolve));
      },
    } },
    parameterBuffers: new Map([["camera", {
      buffer: {}, bytes: new Uint8Array(96), byteLength: 96,
      descriptor: { fields: [
        { name: "position", byte_offset: 0, components: 3 },
        { name: "target", byte_offset: 12, components: 3 },
        { name: "up", byte_offset: 24, components: 3 },
      ] },
    }]]),
  };
  const originalSubmitFrame = adapter.submitFrame;
  adapter.submitFrame = () => { submissions += 1; };
  try {
    adapter.attachCameraControls({
      prepared,
      artifacts: { wasm: {
        cameraControl(horizontal, vertical, zoom) {
          cameraCalls.push([horizontal, vertical, zoom]);
        },
      } },
      canvas: {
        tabIndex: 0, addEventListener() {}, removeEventListener() {}, focus() {},
      },
      eventTarget: {
        addEventListener(name, listener) { windowListeners.set(name, listener); },
        removeEventListener() {},
      },
      requestAnimationFrame(callback) {
        animationFrames.push(callback);
        return animationFrames.length;
      },
      cancelAnimationFrame() {},
      config: { scene_ir: { camera: { properties: {
        pos: [0, -8, 4], target: [0, 0, 1], up: [0, 0, 1],
        controls_mode: "orbit",
      } } } },
    });

    windowListeners.get("keydown")({
      key: "ArrowRight", repeat: false, preventDefault() {},
    });
    windowListeners.get("keydown")({
      key: "ArrowUp", repeat: false, preventDefault() {},
    });
    assert.deepEqual(cameraCalls, [[1, 0, 0]],
      "the busy GPU slot must not mutate an unrendered camera");
    assert.equal(submissions, 1);

    completions.shift()();
    await Promise.resolve();
    await Promise.resolve();
    assert.deepEqual(cameraCalls, [[1, 0, 0], [1, 1, 0]],
      "a busy-slot keydown must submit as soon as GPU completion frees the slot");
    assert.equal(submissions, 2,
      "fresh input must not wait for the next animation frame after completion");

    windowListeners.get("keyup")({ key: "ArrowRight", preventDefault() {} });
    windowListeners.get("keyup")({ key: "ArrowUp", preventDefault() {} });
  } finally {
    adapter.submitFrame = originalSubmitFrame;
  }
});

test("compiled held arrows never queue stale camera frames behind the GPU", async () => {
  const windowListeners = new Map();
  const animationFrames = [];
  const completions = [];
  const cameraCalls = [];
  let submissions = 0;
  const prepared = {
    device: { queue: {
      writeBuffer() {},
      onSubmittedWorkDone() {
        return new Promise((resolve) => completions.push(resolve));
      },
    } },
    parameterBuffers: new Map([["camera", {
      buffer: {}, bytes: new Uint8Array(96), byteLength: 96,
      descriptor: { fields: [
        { name: "position", byte_offset: 0, components: 3 },
        { name: "target", byte_offset: 12, components: 3 },
        { name: "up", byte_offset: 24, components: 3 },
      ] },
    }]]),
  };
  const canvas = {
    tabIndex: 0,
    addEventListener() {},
    removeEventListener() {},
    focus() {},
  };
  const originalSubmitFrame = adapter.submitFrame;
  adapter.submitFrame = () => { submissions += 1; };
  try {
    adapter.attachCameraControls({
      prepared,
      artifacts: { wasm: {
        cameraControl(horizontal, vertical, zoom) {
          cameraCalls.push([horizontal, vertical, zoom]);
        },
      } },
      canvas,
      eventTarget: {
        addEventListener(name, listener) { windowListeners.set(name, listener); },
        removeEventListener() {},
      },
      requestAnimationFrame(callback) {
        animationFrames.push(callback);
        return animationFrames.length;
      },
      cancelAnimationFrame() {},
      config: { scene_ir: { camera: { properties: {
        pos: [0, -8, 4], target: [0, 0, 1], up: [0, 0, 1],
        controls_mode: "orbit",
      } } } },
    });

    windowListeners.get("keydown")({
      key: "ArrowRight", repeat: false, preventDefault() {},
    });
    assert.equal(submissions, 1, "keydown must submit the first frame immediately");
    assert.equal(completions.length, 1, "the first camera frame must own the GPU slot");

    for (const timestamp of [16.67, 33.34, 50.01]) {
      animationFrames.shift()(timestamp);
    }
    assert.equal(submissions, 1,
      "display ticks must not build a stale GPU command backlog");
    assert.deepEqual(cameraCalls, [[1, 0, 0]],
      "busy display ticks must not accumulate hidden camera movement");

    windowListeners.get("keyup")({ key: "ArrowRight", preventDefault() {} });
    completions.shift()();
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(submissions, 1,
      "GPU completion after key release must not submit delayed movement");
    assert.deepEqual(cameraCalls, [[1, 0, 0]],
      "key release must discard all unsent movement");
  } finally {
    adapter.submitFrame = originalSubmitFrame;
  }
});

test("compiled camera controls stop when focus loss consumes keyup", () => {
  const windowListeners = new Map();
  const animationFrames = [];
  const cameraCalls = [];
  let submissions = 0;
  const prepared = {
    device: { queue: { writeBuffer() {} } },
    parameterBuffers: new Map([["camera", {
      buffer: {}, bytes: new Uint8Array(96), byteLength: 96,
      descriptor: { fields: [
        { name: "position", byte_offset: 0, components: 3 },
        { name: "target", byte_offset: 12, components: 3 },
        { name: "up", byte_offset: 24, components: 3 },
      ] },
    }]]),
  };
  const originalSubmitFrame = adapter.submitFrame;
  adapter.submitFrame = () => { submissions += 1; };
  try {
    adapter.attachCameraControls({
      prepared,
      artifacts: { wasm: {
        cameraControl(horizontal, vertical, zoom) {
          cameraCalls.push([horizontal, vertical, zoom]);
        },
      } },
      canvas: {
        tabIndex: 0, addEventListener() {}, removeEventListener() {}, focus() {},
      },
      eventTarget: {
        addEventListener(name, listener) { windowListeners.set(name, listener); },
        removeEventListener() {},
      },
      requestAnimationFrame(callback) {
        animationFrames.push(callback);
        return animationFrames.length;
      },
      cancelAnimationFrame() {},
      config: { scene_ir: { camera: { properties: {
        pos: [0, -8, 4], target: [0, 0, 1], up: [0, 0, 1],
        controls_mode: "orbit",
      } } } },
    });
    windowListeners.get("keydown")({
      key: "ArrowRight", repeat: false, preventDefault() {},
    });
    windowListeners.get("blur")();
    animationFrames.shift()(16.67);
    assert.deepEqual(cameraCalls, [[1, 0, 0]],
      "focus loss must clear held movement even when keyup is never delivered");
    assert.equal(submissions, 1);
  } finally {
    adapter.submitFrame = originalSubmitFrame;
  }
});

test("compiled camera controls stop after rejected GPU work", async () => {
  const windowListeners = new Map();
  const animationFrames = [];
  const cameraCalls = [];
  let submissions = 0;
  const prepared = {
    device: { queue: {
      writeBuffer() {},
      onSubmittedWorkDone() { return Promise.reject(new Error("device lost")); },
    } },
    parameterBuffers: new Map([["camera", {
      buffer: {}, bytes: new Uint8Array(96), byteLength: 96,
      descriptor: { fields: [
        { name: "position", byte_offset: 0, components: 3 },
        { name: "target", byte_offset: 12, components: 3 },
        { name: "up", byte_offset: 24, components: 3 },
      ] },
    }]]),
  };
  const originalSubmitFrame = adapter.submitFrame;
  adapter.submitFrame = () => { submissions += 1; };
  try {
    adapter.attachCameraControls({
      prepared,
      artifacts: { wasm: {
        cameraControl(horizontal, vertical, zoom) {
          cameraCalls.push([horizontal, vertical, zoom]);
        },
      } },
      canvas: {
        tabIndex: 0, addEventListener() {}, removeEventListener() {}, focus() {},
      },
      eventTarget: {
        addEventListener(name, listener) { windowListeners.set(name, listener); },
        removeEventListener() {},
      },
      requestAnimationFrame(callback) {
        animationFrames.push(callback);
        return animationFrames.length;
      },
      cancelAnimationFrame() {},
      config: { scene_ir: { camera: { properties: {
        pos: [0, -8, 4], target: [0, 0, 1], up: [0, 0, 1],
        controls_mode: "orbit",
      } } } },
    });
    windowListeners.get("keydown")({
      key: "ArrowRight", repeat: false, preventDefault() {},
    });
    await Promise.resolve();
    await Promise.resolve();
    animationFrames.shift()(16.67);
    assert.deepEqual(cameraCalls, [[1, 0, 0]],
      "rejected GPU work must clear held input instead of retrying forever");
    assert.equal(submissions, 1);
  } finally {
    adapter.submitFrame = originalSubmitFrame;
  }
});

test("compiled camera controls survive synchronous GPU completion failure", () => {
  const windowListeners = new Map();
  const animationFrames = [];
  const cameraCalls = [];
  let submissions = 0;
  const prepared = {
    device: { queue: {
      writeBuffer() {},
      onSubmittedWorkDone() { throw new Error("device removed"); },
    } },
    parameterBuffers: new Map([["camera", {
      buffer: {}, bytes: new Uint8Array(96), byteLength: 96,
      descriptor: { fields: [
        { name: "position", byte_offset: 0, components: 3 },
        { name: "target", byte_offset: 12, components: 3 },
        { name: "up", byte_offset: 24, components: 3 },
      ] },
    }]]),
  };
  const originalSubmitFrame = adapter.submitFrame;
  adapter.submitFrame = () => { submissions += 1; };
  try {
    adapter.attachCameraControls({
      prepared,
      artifacts: { wasm: {
        cameraControl(horizontal, vertical, zoom) {
          cameraCalls.push([horizontal, vertical, zoom]);
        },
      } },
      canvas: {
        tabIndex: 0, addEventListener() {}, removeEventListener() {}, focus() {},
      },
      eventTarget: {
        addEventListener(name, listener) { windowListeners.set(name, listener); },
        removeEventListener() {},
      },
      requestAnimationFrame(callback) {
        animationFrames.push(callback);
        return animationFrames.length;
      },
      cancelAnimationFrame() {},
      config: { scene_ir: { camera: { properties: {
        pos: [0, -8, 4], target: [0, 0, 1], up: [0, 0, 1],
        controls_mode: "orbit",
      } } } },
    });
    assert.doesNotThrow(() => windowListeners.get("keydown")({
      key: "ArrowRight", repeat: false, preventDefault() {},
    }));
    animationFrames.shift()(16.67);
    assert.deepEqual(cameraCalls, [[1, 0, 0]],
      "synchronous completion failure must clear held input");
    assert.equal(submissions, 1);
  } finally {
    adapter.submitFrame = originalSubmitFrame;
  }
});

test("compiled adapter submits compiler-declared compute and render passes in one command buffer", () => {
  const calls = [];
  const renderDescriptors = [];
  function pass(kind) {
    return {
      setPipeline(value) { calls.push([kind, "pipeline", value.id]); },
      setBindGroup(group) { calls.push([kind, "bind", group]); },
      setViewport(x, y, width, height) { calls.push([kind, "viewport", width, height]); },
      setVertexBuffer(_slot, _buffer, offset, size) { calls.push([kind, "vertex", offset, size]); },
      setIndexBuffer(_buffer, format, offset, size) { calls.push([kind, "index", format, offset, size]); },
      dispatchWorkgroups(x, y, z) { calls.push([kind, "dispatch", x, y, z]); },
      drawIndexed(count) { calls.push([kind, "drawIndexed", count]); },
      draw(count, instances) { calls.push([kind, "draw", count, instances]); },
      end() { calls.push([kind, "end"]); },
    };
  }
  const device = {
    queue: { submit(buffers) { calls.push(["submit", buffers.length]); } },
    createBindGroup(descriptor) {
      calls.push(["createBindGroup", descriptor.label]);
      return { descriptor };
    },
    createCommandEncoder() {
      return {
        beginComputePass() { return pass("compute"); },
        beginRenderPass(descriptor) {
          renderDescriptors.push(descriptor);
          return pass("render");
        },
        finish() { calls.push(["finish"]); return { command: true }; },
      };
    },
  };
  const pipeline = (id) => ({ id, getBindGroupLayout(group) { return { id, group }; } });
  const texture = (id) => ({ createView(options) { return { id, options }; } });
  const prepared = {
    device,
    context: { getCurrentTexture() { return texture("swap"); } },
    arenaBuffer: { id: "arena" },
    arenaBytes: new Uint8Array(1024),
    parameterBuffers: new Map([["camera", { buffer: { id: "camera" }, byteLength: 64 }]]),
    resourceBuffers: new Map([
      ["derived_scene", { id: "derived_scene" }],
      ["derived_objects", { id: "derived_objects" }],
      ["pass_state_arena", { id: "pass_state" }],
    ]),
    samplers: new Map(),
    pipelines: new Map([
      ["prepare", pipeline("prepare")],
      ["shadow", pipeline("shadow")],
      ["scene", pipeline("scene")],
      ["flare", pipeline("flare")],
      ["emitter", pipeline("emitter")],
    ]),
    targets: new Map([
      ["surface", { id: "surface", kind: "color", width: 800, height: 450, view: { id: "surface" } }],
      ["depth", { id: "depth", kind: "depth", width: 800, height: 450, view: { id: "depth" } }],
      ["swap_chain", { id: "swap_chain", kind: "external_color", width: 800, height: 450 }],
    ]),
    parameterDescriptor: {
      draw_lists: [{ id: "scene", entries: [{
        object_index: 0,
        object_uniform_byte_offset: 0,
        object_uniform_byte_length: 256,
        vertices: { byte_offset: 0, length: 30 },
        indices: { byte_offset: 120, length: 3 },
        index_format: "uint32",
      }] }],
    },
    plan: { targets: [], passes: [{
      kind: "prepare_frame",
      pipeline: "prepare",
      dispatch: { x: 1, y: 1, z: 1 },
      bind_groups: [{ group: 2, entries: [{
        binding: 0,
        source: "render_parameter_arena.camera",
        resource_type: "read_only_storage_buffer",
        size: 64,
      }] }],
    }, {
      kind: "shadow_depth",
      pipeline: "shadow",
      draw_list_id: "scene",
      depth: { target: "depth", array_layer: 0, load_op: "clear", store_op: "store", clear_value: 1, read_only: false },
      bind_groups: [{ group: 0, entries: [{
        binding: 0, source: "derived_scene", resource_type: "uniform_buffer", size: 480,
      }] }],
    }, {
      kind: "scene_color",
      pipeline: "scene",
      draw_list_id: "scene",
      viewport: { policy: "target" },
      color: { target: "surface", load_op: "clear", store_op: "store", clear_value: [0, 0, 0, 0], resolve_target: "swap_chain" },
      depth: { target: "depth", array_layer: 0, load_op: "clear", store_op: "store", clear_value: 1, read_only: false },
      bind_groups: [{ group: 0, entries: [
        { binding: 0, source: "derived_scene", resource_type: "uniform_buffer", size: 480 },
        { binding: 6, source: "pass_state_arena", resource_type: "uniform_buffer", offset: 0, size: 32 },
      ] }, { group: 1, entries: [
        { binding: 0, source: "derived_objects", resource_type: "uniform_buffer", size: 256 },
      ] }],
      object_binding: {
        group: 1,
        binding: 0,
        source: "derived_objects",
        byte_offset_source: "draw.object_uniform_byte_offset",
        byte_length_source: "draw.object_uniform_byte_length",
      },
    }, {
      kind: "light_flares",
      pipeline: "flare",
      vertex_count: 6,
      instance_count: 1,
      color: { target: "surface", load_op: "load", store_op: "store", resolve_target: "swap_chain" },
      depth: { target: "depth", array_layer: 0, load_op: "load", store_op: "store", clear_value: 1, read_only: true },
      bind_groups: [],
    }, {
      kind: "light_emitters",
      pipeline: "emitter",
      vertex_count: 6,
      instance_count: 1,
      color: { target: "surface", load_op: "load", store_op: "store", resolve_target: "swap_chain" },
      depth: { target: "depth", array_layer: 0, load_op: "load", store_op: "store", clear_value: 1, read_only: false },
      bind_groups: [],
    }] },
  };

  adapter.submitFrame(prepared, { reuseStaticShadows: true });
  assert.deepEqual(calls.filter((call) => call[1] === "pipeline"), [
    ["compute", "pipeline", "prepare"],
    ["render", "pipeline", "shadow"],
    ["render", "pipeline", "scene"],
    ["render", "pipeline", "flare"],
    ["render", "pipeline", "emitter"],
  ]);
  assert.deepEqual(calls.find((call) => call[1] === "dispatch"), ["compute", "dispatch", 1, 1, 1]);
  assert.deepEqual(calls.find((call) => call[1] === "drawIndexed"), ["render", "drawIndexed", 3]);
  assert.deepEqual(calls.slice(-2), [["finish"], ["submit", 1]]);
  assert.equal(renderDescriptors.length, 2,
    "compatible scene, flare, and emitter draws must share one render pass");
  assert.deepEqual(renderDescriptors.at(-1).depthStencilAttachment, {
    view: { id: "depth" },
    depthReadOnly: false,
    depthLoadOp: "clear",
    depthStoreOp: "store",
    depthClearValue: 1,
  }, "the fused pass must retain the base scene depth policy");

  const bindGroupCreations = calls.filter((call) => call[0] === "createBindGroup").length;
  calls.length = 0;
  adapter.submitFrame(prepared, { reuseStaticShadows: true });
  assert.deepEqual(calls.filter((call) => call[1] === "pipeline"), [
    ["compute", "pipeline", "prepare"],
    ["render", "pipeline", "scene"],
    ["render", "pipeline", "flare"],
    ["render", "pipeline", "emitter"],
  ], "camera-only frames must reuse static shadow maps");
  assert.equal(renderDescriptors.length, 3,
    "camera-only submission must add one fused scene render pass");
  assert.equal(
    calls.filter((call) => call[0] === "createBindGroup").length,
    0,
    "camera-only frames must reuse stable bind groups",
  );
  assert.ok(bindGroupCreations > 0);
});

test("compiled adapter uploads only changed light parameters and redraws their views", () => {
  const calls = [];
  const renderPass = {
    setPipeline(pipeline) { calls.push(["renderPipeline", pipeline.id]); },
    setBindGroup() {},
    setViewport() {},
    draw() {},
    end() {},
  };
  const computePass = {
    setPipeline(pipeline) { calls.push(["computePipeline", pipeline.id]); },
    setBindGroup() {},
    dispatchWorkgroups() {},
    end() {},
  };
  const device = {
    queue: {
      writeBuffer(buffer, offset, bytes) {
        calls.push(["writeBuffer", buffer.id, offset, bytes.byteLength]);
      },
      submit() {},
    },
    createBuffer() { throw new Error("changed parameters must not recreate buffers"); },
    createBindGroup() { throw new Error("changed parameters must not recreate bind groups"); },
    createCommandEncoder() {
      return {
        beginComputePass() { return computePass; },
        beginRenderPass() { return renderPass; },
        finish() { return {}; },
      };
    },
  };
  const pipeline = (id) => ({ id, getBindGroupLayout() { return {}; } });
  const cameraBuffer = { id: "camera" };
  const lightsBuffer = { id: "lights" };
  const objectsBuffer = { id: "objects" };
  const arenaBuffer = { id: "arena" };
  const parameterBuffers = new Map([
    ["camera", { buffer: cameraBuffer, bytes: new Uint8Array(96), byteLength: 96 }],
    ["lights", { buffer: lightsBuffer, bytes: new Uint8Array(336), byteLength: 336 }],
    ["objects", { buffer: objectsBuffer, bytes: new Uint8Array(384), byteLength: 384 }],
  ]);
  const passes = [
    { kind: "prepare_frame", pipeline: "prepare", dispatch: { x: 1, y: 1, z: 1 } },
    { kind: "prepare_shadow_views", pipeline: "shadow-prepare", dispatch: { x: 1, y: 1, z: 1 } },
    ...Array.from({ length: 4 }, (_, index) => ({
      kind: "prepare_reflection_camera",
      pipeline: `reflection-prepare-${index}`,
      dispatch: { x: 1, y: 1, z: 1 },
    })),
    ...Array.from({ length: 5 }, (_, index) => ({
      kind: "shadow_depth",
      pipeline: `shadow-${index}`,
      vertex_count: 3,
    })),
    ...Array.from({ length: 4 }, (_, index) => ({
      kind: "planar_reflection",
      pipeline: `reflection-${index}`,
      vertex_count: 3,
    })),
  ];
  const prepared = {
    device,
    arenaBuffer,
    arenaBytes: new Uint8Array(1_438_352),
    parameterBuffers,
    resourceBuffers: new Map(),
    samplers: new Map(),
    pipelines: new Map(passes.map(({ pipeline: id }) => [id, pipeline(id)])),
    targets: new Map(),
    parameterDescriptor: { draw_lists: [] },
    plan: { targets: [], passes },
    initialTargetsReady: true,
    shadowMapsInitialized: true,
    bindGroupCache: new Map(),
  };

  parameterBuffers.get("lights").bytes[0] = 1;
  adapter.submitFrame(prepared, { changedParameterSections: ["lights"] });

  assert.deepEqual(
    calls.filter(([kind]) => kind === "writeBuffer"),
    [["writeBuffer", "lights", 0, 336]],
    "a moving emitter must upload only its light parameter section",
  );
  assert.equal(
    calls.filter(([kind]) => kind === "computePipeline").length,
    6,
    "direct and virtual LightViews must be refreshed",
  );
  assert.equal(
    calls.filter(([, id]) => /^shadow-\d$/u.test(id)).length,
    5,
    "all five dependent shadow views must redraw",
  );
  assert.equal(
    calls.filter(([, id]) => /^reflection-\d$/u.test(id)).length,
    4,
    "all four reflections must redraw with the changed illumination",
  );
  assert.equal(prepared.arenaBuffer, arenaBuffer);
  assert.equal(prepared.parameterBuffers, parameterBuffers);
  assert.equal(parameterBuffers.get("camera").buffer, cameraBuffer);
  assert.equal(parameterBuffers.get("lights").buffer, lightsBuffer);
  assert.equal(parameterBuffers.get("objects").buffer, objectsBuffer);

  calls.length = 0;
  adapter.submitFrame(prepared, { changedParameterSections: ["camera"] });
  assert.deepEqual(
    calls.filter(([kind]) => kind === "writeBuffer"),
    [["writeBuffer", "camera", 0, 96]],
  );
  assert.equal(
    calls.filter(([, id]) => /^shadow-\d$/u.test(id)).length,
    0,
    "camera-only changes may reuse initialized shadow maps",
  );

  calls.length = 0;
  adapter.submitFrame(prepared, { changedParameterSections: ["objects"] });
  assert.deepEqual(
    calls.filter(([kind]) => kind === "writeBuffer"),
    [["writeBuffer", "objects", 0, 384]],
  );
  assert.equal(
    calls.filter(([, id]) => /^shadow-\d$/u.test(id)).length,
    5,
    "object changes must redraw every dependent shadow map",
  );
});

test("reflected shadow passes omit their aperture draw", () => {
  const draws = [];
  const render = {
    setPipeline() {},
    setVertexBuffer() {},
    setIndexBuffer() {},
    drawIndexed(count) { draws.push(count); },
    end() {},
  };
  const device = {
    queue: { submit() {} },
    createCommandEncoder() {
      return {
        beginRenderPass() { return render; },
        finish() { return {}; },
      };
    },
  };
  const entry = (objectIndex, indexCount) => ({
    object_index: objectIndex,
    vertices: { byte_offset: objectIndex * 120, length: 30 },
    indices: { byte_offset: 240 + objectIndex * 12, length: indexCount },
    index_format: "uint32",
  });
  const prepared = {
    device,
    arenaBuffer: {},
    arenaBytes: new Uint8Array(512),
    parameterBuffers: new Map(),
    resourceBuffers: new Map(),
    samplers: new Map(),
    pipelines: new Map([["shadow", { getBindGroupLayout() { return {}; } }]]),
    targets: new Map([["depth", {
      id: "depth", kind: "depth", width: 32, height: 32, arrayLayers: 1, view: {},
    }]]),
    parameterDescriptor: {
      draw_lists: [{ id: "shadow_casters", entries: [entry(0, 3), entry(1, 6)] }],
    },
    plan: { targets: [], passes: [{
      kind: "shadow_depth",
      pipeline: "shadow",
      draw_list_id: "shadow_casters",
      excluded_object_indices: [1],
      depth: {
        target: "depth", array_layer: 0, load_op: "clear",
        store_op: "store", clear_value: 1, read_only: false,
      },
      bind_groups: [],
    }] },
    initialTargetsReady: true,
    shadowMapsInitialized: false,
    bindGroupCache: new Map(),
  };

  adapter.submitFrame(prepared);

  assert.deepEqual(draws, [3], "the mirror aperture must not enter its reflected LightView");
});

test("compiled adapter binds a one-layer shadow target as a 2d-array view", () => {
  const viewCalls = [];
  const bindGroups = [];
  const renderPass = {
    setPipeline() {},
    setBindGroup() {},
    setViewport() {},
    draw() {},
    end() {},
  };
  const device = {
    queue: { submit() {} },
    createBindGroup(descriptor) {
      bindGroups.push(descriptor);
      return descriptor;
    },
    createCommandEncoder() {
      return {
        beginRenderPass() { return renderPass; },
        finish() { return {}; },
      };
    },
  };
  const shadowTexture = {
    createView(options) {
      viewCalls.push(options);
      return { kind: "shadow-array-view", options };
    },
  };
  const prepared = {
    device,
    context: { getCurrentTexture() { return { createView() { return {}; } }; } },
    arenaBuffer: {},
    arenaBytes: new Uint8Array(4),
    parameterBuffers: new Map(),
    resourceBuffers: new Map(),
    samplers: new Map(),
    pipelines: new Map([[
      "scene",
      { getBindGroupLayout() { return {}; } },
    ]]),
    targets: new Map([
      ["surface", {
        id: "surface", kind: "color", width: 32, height: 32, view: {},
      }],
      ["shadow_depth", {
        id: "shadow_depth",
        kind: "depth",
        width: 2048,
        height: 2048,
        arrayLayers: 1,
        texture: shadowTexture,
        view: { kind: "default-2d-view" },
      }],
    ]),
    parameterDescriptor: { draw_lists: [] },
    plan: { targets: [], passes: [{
      kind: "scene_present",
      pipeline: "scene",
      vertex_count: 3,
      color: {
        target: "surface",
        load_op: "clear",
        store_op: "store",
        clear_value: [0, 0, 0, 1],
      },
      bind_groups: [{
        group: 0,
        entries: [{
          binding: 2,
          source: "shadow_depth",
          resource_type: "depth_texture_array",
          size: null,
        }],
      }],
    }] },
  };

  adapter.submitFrame(prepared);

  assert.deepEqual(viewCalls, [{
    dimension: "2d-array",
    baseArrayLayer: 0,
    arrayLayerCount: 1,
  }]);
  assert.equal(
    bindGroups[0].entries[0].resource.kind,
    "shadow-array-view",
  );
});
