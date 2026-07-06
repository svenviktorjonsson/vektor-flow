const assert = require("node:assert/strict");
const shared = require("../../web/vf-ui/vf-shared-runtime.js");
const gpu = require("../../web/vf-ui/vf-gpu-runtime.js");

function createFakeAdapter() {
  return {
    writes: [],
    writeBuffer(offset, bytes) {
      this.writes.push({ offset, bytes: new Float32Array(bytes) });
    }
  };
}

{
  const arena = shared.createTransformArena(4);
  const adapter = createFakeAdapter();
  const renderer = gpu.createTransformRenderer({ arena, adapter });

  arena.setTranslate2D(2, 0.25, 0.5);

  const flush = renderer.flushDirtyTransforms();

  assert.equal(adapter.writes.length, 1);
  assert.equal(adapter.writes[0].offset, 2 * shared.MAT4_F32 * Float32Array.BYTES_PER_ELEMENT);
  assert.equal(adapter.writes[0].bytes.length, shared.MAT4_F32);
  assert.equal(adapter.writes[0].bytes[12], 0.25);
  assert.equal(adapter.writes[0].bytes[13], 0.5);
  assert.deepEqual(flush, {
    version: 1,
    min: 2,
    max: 2,
    bytesWritten: shared.MAT4_F32 * Float32Array.BYTES_PER_ELEMENT
  });

  const cleanFlush = renderer.flushDirtyTransforms();
  assert.equal(adapter.writes.length, 1);
  assert.equal(cleanFlush.bytesWritten, 0);
}

{
  const arena = shared.createTransformArena(4);
  const adapter = createFakeAdapter();
  const renderer = gpu.createTransformRenderer({ arena, adapter, byteOffset: 128 });

  arena.setTranslate2D(1, 1, 2);
  arena.setTranslate2D(3, 3, 4);

  const flush = renderer.flushDirtyTransforms();

  assert.equal(adapter.writes.length, 1);
  assert.equal(adapter.writes[0].offset, 128 + 1 * shared.MAT4_F32 * Float32Array.BYTES_PER_ELEMENT);
  assert.equal(adapter.writes[0].bytes.length, 3 * shared.MAT4_F32);
  assert.equal(adapter.writes[0].bytes[12], 1);
  assert.equal(adapter.writes[0].bytes[13], 2);
  assert.equal(adapter.writes[0].bytes[2 * shared.MAT4_F32 + 12], 3);
  assert.equal(adapter.writes[0].bytes[2 * shared.MAT4_F32 + 13], 4);
  assert.equal(flush.bytesWritten, 3 * shared.MAT4_F32 * Float32Array.BYTES_PER_ELEMENT);
}

{
  const gpuBuffer = { label: "transforms" };
  const calls = [];
  const device = {
    queue: {
      writeBuffer(buffer, offset, source, sourceOffset, byteLength) {
        calls.push({ buffer, offset, source, sourceOffset, byteLength });
      }
    }
  };
  const adapter = gpu.createWebGpuTransformAdapter({ device, buffer: gpuBuffer });
  const floats = new Float32Array([1, 2, 3, 4]);
  const slice = floats.subarray(1, 3);

  adapter.writeBuffer(64, slice);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].buffer, gpuBuffer);
  assert.equal(calls[0].offset, 64);
  assert.equal(calls[0].source, floats.buffer);
  assert.equal(calls[0].sourceOffset, Float32Array.BYTES_PER_ELEMENT);
  assert.equal(calls[0].byteLength, 2 * Float32Array.BYTES_PER_ELEMENT);
}

{
  const glBuffer = { label: "transform-buffer" };
  const calls = [];
  const gl = {
    ARRAY_BUFFER: 0x8892,
    bindBuffer(target, buffer) {
      calls.push({ op: "bindBuffer", target, buffer });
    },
    bufferSubData(target, offset, bytes) {
      calls.push({ op: "bufferSubData", target, offset, bytes: new Float32Array(bytes) });
    }
  };
  const adapter = gpu.createWebGlTransformAdapter({ gl, buffer: glBuffer });
  const arena = shared.createTransformArena(3);
  const renderer = gpu.createTransformRenderer({ arena, adapter });

  arena.setTranslate2D(1, 7, 8);
  const flush = renderer.flushDirtyTransforms();

  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], { op: "bindBuffer", target: gl.ARRAY_BUFFER, buffer: glBuffer });
  assert.equal(calls[1].op, "bufferSubData");
  assert.equal(calls[1].target, gl.ARRAY_BUFFER);
  assert.equal(calls[1].offset, shared.MAT4_F32 * Float32Array.BYTES_PER_ELEMENT);
  assert.equal(calls[1].bytes.length, shared.MAT4_F32);
  assert.equal(calls[1].bytes[12], 7);
  assert.equal(calls[1].bytes[13], 8);
  assert.equal(flush.bytesWritten, shared.MAT4_F32 * Float32Array.BYTES_PER_ELEMENT);
}

{
  global.GPUBufferUsage = { COPY_DST: 8, VERTEX: 32, UNIFORM: 64, STORAGE: 128 };
  global.GPUShaderStage = { COMPUTE: 4 };
  const calls = [];
  const device = {
    queue: {
      writeBuffer(buffer, offset, source, sourceOffset, byteLength) {
        calls.push({ op: "writeBuffer", buffer, offset, source, sourceOffset, byteLength });
      }
    },
    createBuffer(desc) {
      const buffer = {
        label: desc.label,
        size: desc.size,
        usage: desc.usage,
        destroyed: false,
        destroy() { this.destroyed = true; }
      };
      calls.push({ op: "createBuffer", desc, buffer });
      return buffer;
    },
    createShaderModule(desc) {
      calls.push({ op: "createShaderModule", desc });
      return { label: desc.label, code: desc.code };
    },
    createBindGroupLayout(desc) {
      calls.push({ op: "createBindGroupLayout", desc });
      return { label: desc.label, entries: desc.entries };
    },
    createPipelineLayout(desc) {
      calls.push({ op: "createPipelineLayout", desc });
      return { label: desc.label };
    },
    createComputePipeline(desc) {
      calls.push({ op: "createComputePipeline", entryPoint: desc.compute.entryPoint });
      return { entryPoint: desc.compute.entryPoint };
    },
    createBindGroup(desc) {
      calls.push({ op: "createBindGroup", desc });
      return { label: desc.label, entries: desc.entries };
    }
  };
  const encoder = {
    beginComputePass(desc) {
      calls.push({ op: "beginComputePass", desc });
      return {
        setPipeline(pipe) { calls.push({ op: "setPipeline", entryPoint: pipe.entryPoint }); },
        setBindGroup(index, bindGroup) { calls.push({ op: "setBindGroup", index, bindGroup }); },
        dispatchWorkgroups(groups) { calls.push({ op: "dispatchWorkgroups", groups }); },
        end() { calls.push({ op: "endComputePass" }); }
      };
    }
  };
  const runtime = gpu.createHardDiscPhysicsRuntime({
    device,
    particleCount: 2,
    particles: [
      { x: 0.2, y: 0.3, vx: 1.0, vy: 0.0, radius: 0.02, density: 1.5 },
      { x: 0.7, y: 0.3, vx: -1.0, vy: 0.0, radius: 0.03, density: 2.0 }
    ],
    width: 1.2,
    height: 0.8,
    gravity: [0, -9.81],
    restitution: 0.5,
    maxRadius: 0.03,
    wgsl: "shader"
  });

  assert.equal(runtime.particleCount, 2);
  assert.ok((runtime.renderInstanceBuffer.usage & global.GPUBufferUsage.VERTEX) !== 0);
  assert.ok((runtime.renderInstanceBuffer.usage & global.GPUBufferUsage.STORAGE) !== 0);
  assert.deepEqual(
    calls.filter((call) => call.op === "createComputePipeline").map((call) => call.entryPoint),
    ["clear_cells", "integrate", "fill_cells", "resolve_contacts", "write_render_instances"]
  );
  const bindLayout = calls.find((call) => call.op === "createBindGroupLayout");
  assert.equal(bindLayout.desc.entries.length, 6);

  runtime.step(encoder, 1 / 60);

  assert.deepEqual(
    calls.filter((call) => call.op === "setPipeline").map((call) => call.entryPoint),
    ["integrate", "clear_cells", "fill_cells", "resolve_contacts", "resolve_contacts", "resolve_contacts", "write_render_instances"]
  );
  assert.equal(calls.filter((call) => call.op === "dispatchWorkgroups").length, 7);
  assert.ok(calls.some((call) => call.op === "writeBuffer" && call.buffer === runtime.paramsBuffer));

  runtime.destroy();
  assert.equal(runtime.particleBuffer.destroyed, true);
  assert.equal(runtime.renderInstanceBuffer.destroyed, true);
}

console.log("vf-gpu-runtime tests passed");
