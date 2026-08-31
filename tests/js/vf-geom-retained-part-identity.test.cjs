const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(
  path.join(__dirname, '../../web/vf-ui/geom/vf-geom-wgpu.js'),
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
    VfGeomMath: {},
  });
  vm.runInContext(source, context, { filename: 'vf-geom-wgpu.js' });
  return new context.VfGeomWgpu({ width: 800, height: 450 }, () => null);
}

const packet = (id, objectId) => ({
  id,
  object_id: objectId,
  topology: 'triangle-list',
  static_vertices: true,
  static_indices: true,
  vertices: new Float32Array(40),
  indices: new Uint32Array(9),
});

const part = (mesh) => ({
  mesh,
  vb: {},
  ib: {},
  uniformBuf: {},
  shadowUniformBuf0: {},
  shadowUniformBuf1: {},
  shadowUniformBuf2: {},
  shadowUniformBuf3: {},
  pickUb: {},
  pickBg: {},
  bindGroup: {},
  topology: 'triangle-list',
  instanceKind: null,
  physicsRuntime: null,
  objectId: mesh.object_id,
  staticVertices: true,
  staticIndices: true,
});

test('retained geometry parts follow stable object identity across packet reorder', () => {
  const renderer = loadRenderer();
  const coarseMesh = packet('coarse', 1);
  const evictedMesh = packet('evicted', 2);
  const retainedMesh = packet('retained', 6);
  const coarsePart = part(coarseMesh);
  const evictedPart = part(evictedMesh);
  const retainedPart = part(retainedMesh);
  const created = [];
  const destroyed = [];
  const writes = [];
  renderer._device = {
    queue: {
      writeBuffer: (...args) => writes.push(args),
    },
  };
  renderer._parts = [coarsePart, evictedPart, retainedPart];
  renderer._createScenePart = (mesh) => {
    created.push(mesh.object_id);
    return part(mesh);
  };
  renderer._destroyPart = (candidate) => destroyed.push(candidate.objectId);
  renderer._ensurePartBindGroup = (candidate) => {
    candidate.bindGroup = candidate.bindGroup || {};
  };

  const newMesh = packet('new', 3);
  renderer._uploadSceneParts({ parts: [coarseMesh, retainedMesh, newMesh] });

  assert.strictEqual(renderer._parts[0], coarsePart);
  assert.strictEqual(renderer._parts[1], retainedPart);
  assert.equal(renderer._parts[1].depthOrder, 1);
  assert.deepEqual(created, [3]);
  assert.deepEqual(destroyed, [2]);
  assert.deepEqual(writes, []);
});
