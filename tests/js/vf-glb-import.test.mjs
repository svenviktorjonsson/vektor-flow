import assert from 'node:assert/strict';
import test from 'node:test';
import { exportGlbAsset, importGlb } from '../../web/vf-ui/vf-glb-import.mjs';

test('imports a glTF triangle and preserves the original GLB losslessly', () => {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const binary = new Uint8Array(positions.buffer);
  const json = {
    asset: { version: '2.0' },
    buffers: [{ byteLength: binary.byteLength }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: binary.byteLength }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0 }] }],
    materials: [{ pbrMetallicRoughness: { baseColorFactor: [1, 0, 0, 1] } }],
    nodes: [{ mesh: 0, translation: [2, 3, 4] }],
    scenes: [{ nodes: [0] }], scene: 0
  };
  const glb = makeGlb(json, binary);
  const asset = importGlb(glb, { name: 'Triangle' });
  assert.equal(asset.primitives.length, 1);
  assert.deepEqual(asset.primitives[0].positions[0], [2, 3, 4]);
  assert.deepEqual(asset.primitives[0].triangles, [[0, 1, 2]]);
  assert.deepEqual(exportGlbAsset(asset), glb);
});

function makeGlb(json, binary) {
  const encoded = new TextEncoder().encode(JSON.stringify(json));
  const jsonLength = Math.ceil(encoded.length / 4) * 4;
  const binaryLength = Math.ceil(binary.length / 4) * 4;
  const result = new Uint8Array(12 + 8 + jsonLength + 8 + binaryLength);
  const view = new DataView(result.buffer);
  view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, result.length, true);
  view.setUint32(12, jsonLength, true); view.setUint32(16, 0x4e4f534a, true);
  result.fill(0x20, 20, 20 + jsonLength); result.set(encoded, 20);
  const binaryOffset = 20 + jsonLength;
  view.setUint32(binaryOffset, binaryLength, true); view.setUint32(binaryOffset + 4, 0x004e4942, true);
  result.set(binary, binaryOffset + 8);
  return result;
}
