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

console.log("vf-gpu-runtime tests passed");
