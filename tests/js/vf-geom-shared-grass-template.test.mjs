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
    GPUTextureUsage: {
      COPY_SRC: 1,
      RENDER_ATTACHMENT: 2,
      TEXTURE_BINDING: 4,
    },
    GPUBufferUsage: {
      COPY_DST: 8,
      INDEX: 16,
      VERTEX: 32,
    },
    VfGeomMath: {},
  });
  vm.runInContext(source, context, { filename: 'vf-geom-wgpu.js' });
  return new context.VfGeomWgpu({ width: 800, height: 450 }, () => null);
}

test('grass cells acquire and release one shared immutable template GPU buffer', () => {
  const renderer = loadRenderer();
  const created = [];
  const writes = [];
  renderer._device = {
    createBuffer(descriptor) {
      const buffer = {
        descriptor,
        destroyed: 0,
        destroy() { this.destroyed += 1; },
      };
      created.push(buffer);
      return buffer;
    },
    queue: {
      writeBuffer(buffer, offset, data) {
        writes.push({ buffer, offset, data });
      },
    },
  };
  const template = new Float32Array(40);

  const first = renderer._acquireSharedGrassTemplateBuffer(
    renderer._grassVertexTemplateBuffers,
    template,
    32,
    'grass-vertices',
  );
  const second = renderer._acquireSharedGrassTemplateBuffer(
    renderer._grassVertexTemplateBuffers,
    template,
    32,
    'grass-vertices',
  );

  assert.strictEqual(second, first);
  assert.equal(first.references, 2);
  assert.equal(created.length, 1);
  assert.equal(writes.length, 1);
  renderer._releaseSharedGrassTemplateBuffer(
    renderer._grassVertexTemplateBuffers,
    template,
    first,
  );
  assert.equal(first.buffer.destroyed, 0);
  renderer._releaseSharedGrassTemplateBuffer(
    renderer._grassVertexTemplateBuffers,
    template,
    second,
  );
  assert.equal(first.buffer.destroyed, 1);
});

test('scene parts route only grass templates through the shared buffer seam', () => {
  assert.match(source, /mesh\.instance_kind === "grass-blade-list" && mesh\.static_vertices === true/);
  assert.match(source, /sharedGrassVertexEntry/);
  assert.match(source, /sharedGrassIndexEntry/);
});
