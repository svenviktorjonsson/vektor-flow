import assert from "node:assert/strict";
import test from "node:test";

import {
  createWoodSpectralRendererGpuArenaReference,
} from "../../web/vf-ui/vf-wood-spectral-renderer-gpu.mjs";

test("spectral renderer shares buffers until the final packet release", () => {
  const calls = {
    createBuffer: 0,
    writeBuffer: 0,
    createBindGroup: 0,
    destroy: 0,
  };
  const materialBuffer = {
    destroy() {
      calls.destroy += 1;
    },
  };
  const device = {
    createBuffer(specification) {
      calls.createBuffer += 1;
      assert.equal(specification.size, 32);
      return materialBuffer;
    },
    createBindGroup(specification) {
      calls.createBindGroup += 1;
      return { specification };
    },
    queue: {
      writeBuffer(buffer, offset, source) {
        calls.writeBuffer += 1;
        assert.strictEqual(buffer, materialBuffer);
        assert.equal(offset, 0);
        assert.strictEqual(source, descriptor.floats);
      },
    },
  };
  const descriptor = {
    kind: "wood-spectral-presentation-gpu:v1",
    version: 1,
    floats: new Float32Array(8),
    byteLength: 32,
  };
  const firstPacket = {
    kind: "wood-cut-material-triangle-packet:v1",
    wood_spectral_presentation_gpu: descriptor,
  };
  const secondPacket = {
    ...firstPacket,
  };
  const pipeline = {
    getBindGroupLayout(index) {
      assert.equal(index, 0);
      return "material-layout";
    },
  };
  const outputBuffer = {};
  const arena = createWoodSpectralRendererGpuArenaReference(device, {
    resourceBudget: 2,
  });
  const first = arena.acquire(firstPacket);
  const second = arena.acquire(secondPacket);

  assert.strictEqual(first.materialBuffer, materialBuffer);
  assert.strictEqual(second.materialBuffer, materialBuffer);
  assert.notStrictEqual(first, second);
  assert.deepEqual(arena.snapshot(), {
    resourceBudget: 2,
    liveResources: 1,
    liveAcquisitions: 2,
    createdBuffers: 1,
    destroyedBuffers: 0,
    uploadedBytes: 32,
    drawBindings: 0,
  });
  const binding = arena.createDrawBinding(
    first,
    pipeline,
    outputBuffer,
  );
  assert.equal(binding.specification.layout, "material-layout");
  assert.deepEqual(binding.specification.entries, [
    { binding: 0, resource: { buffer: materialBuffer } },
    { binding: 1, resource: { buffer: outputBuffer } },
  ]);
  assert.equal(calls.createBuffer, 1);
  assert.equal(calls.writeBuffer, 1);
  assert.equal(calls.createBindGroup, 1);

  arena.release(first);
  assert.equal(calls.destroy, 0);
  assert.throws(() => arena.release(first), /already released/u);
  arena.release(second);
  assert.equal(calls.destroy, 1);
  assert.deepEqual(arena.snapshot(), {
    resourceBudget: 2,
    liveResources: 0,
    liveAcquisitions: 0,
    createdBuffers: 1,
    destroyedBuffers: 1,
    uploadedBytes: 32,
    drawBindings: 1,
  });
});
