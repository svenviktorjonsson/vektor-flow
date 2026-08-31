import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(
  new URL('../../web/vf-ui/geom/vf-geom-wgpu.js', import.meta.url),
  'utf8',
);

function loadRenderer() {
  const context = vm.createContext({
    console,
    Date,
    setTimeout,
    clearTimeout,
    Uint32Array,
    GPUTextureUsage: {
      COPY_SRC: 1,
      RENDER_ATTACHMENT: 2,
      TEXTURE_BINDING: 4,
    },
    GPUBufferUsage: {
      COPY_DST: 8,
      INDEX: 16,
      VERTEX: 32,
      STORAGE: 64,
      UNIFORM: 128,
    },
    VfGeomMath: {},
  });
  vm.runInContext(source, context, { filename: 'vf-geom-wgpu.js' });
  return new context.VfGeomWgpu({ width: 800, height: 450 }, () => null);
}

test('renderer compiles the internal grass compute shader and routes GPU packets to it', () => {
  assert.match(source, /loadGrassBladeComputeShaderSource/);
  assert.match(source, /createComputePipeline\(/);
  assert.match(source, /mesh\.grass_gpu/);
  assert.match(source, /_createGrassGpuRuntime/);
  assert.match(source, /_updateGrassGpuRuntime/);
  assert.match(source, /mesh\.static_instances === true \|\| \(mesh\.static_instances == null/);
});

test('grass GPU runtime dispatches bounded Philox work and releases all buffers', () => {
  const renderer = loadRenderer();
  const buffers = [];
  const writes = [];
  const dispatches = [];
  const submissions = [];
  renderer._pipeGrassBladeCompute = { name: 'grass-compute' };
  renderer._pipeGrassShadowCompute = { name: 'grass-shadow-compute' };
  renderer._grassBladeComputeBindLayout = { name: 'grass-layout' };
  renderer._device = {
    createBuffer(descriptor) {
      const buffer = {
        descriptor,
        destroyed: 0,
        destroy() { this.destroyed += 1; },
      };
      buffers.push(buffer);
      return buffer;
    },
    createBindGroup(descriptor) { return { descriptor }; },
    createCommandEncoder() {
      return {
        beginComputePass() {
          return {
            setPipeline() {},
            setBindGroup() {},
            dispatchWorkgroups(count) { dispatches.push(count); },
            end() {},
          };
        },
        finish() { return { finished: true }; },
      };
    },
    queue: {
      writeBuffer(buffer, offset, data) { writes.push({ buffer, offset, data }); },
      submit(commands) { submissions.push(commands); },
    },
  };
  const descriptor = {
    kind: 'grass-blade-philox:v1',
    cell_records: new Uint32Array(24),
    cell_stride_words: 12,
    blades_per_cell: 2,
    shadow_blades_per_cell: 1,
    shadow_instance_count: 2,
  };

  const runtime = renderer._createGrassGpuRuntime(descriptor, 4);
  assert.equal(buffers.length, 4);
  assert.deepEqual(buffers.map(({ descriptor: item }) => item.size), [96, 256, 16, 128]);
  assert.equal(writes.length, 2);
  assert.deepEqual(dispatches, [1, 1]);
  assert.equal(submissions.length, 1);
  assert.strictEqual(runtime.instanceBuffer, buffers[1]);
  assert.strictEqual(runtime.shadowInstanceBuffer, buffers[3]);
  assert.equal(runtime.shadowInstanceCount, 2);

  renderer._updateGrassGpuRuntime(runtime, {
    ...descriptor,
    cell_records: new Uint32Array(24).fill(7),
  }, 4);
  assert.equal(writes.length, 4);
  assert.deepEqual(dispatches, [1, 1, 1, 1]);
  assert.equal(submissions.length, 2);

  renderer._destroyGrassGpuRuntime(runtime);
  assert.deepEqual(buffers.map(({ destroyed }) => destroyed), [1, 1, 1, 1]);
});
