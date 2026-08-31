import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createGrassMaterialFieldReference,
  createGrassRendererInstancePacketsReference,
  createGrassRendererPacketsReference,
} from '../../web/vf-ui/vf-grass-material-field.mjs';

const IDENTITY = Object.freeze({
  generator: 'vkf.conditioned',
  version: 1,
  seed: [0x01234567, 0x89abcdef],
  domain: 'material',
  hierarchy: ['world:temperate', 'grass-field:gpu'],
  lod: 0,
  channel: 'surface',
});

const DEMAND = Object.freeze({
  cells: Object.freeze([Object.freeze([2, -1])]),
  detailLevel: 4,
  footprint: 0.01,
  bladeBudget: 16,
});

function close(actual, expected, tolerance = 1e-6) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${actual} differs from ${expected}`,
  );
}

test('grass instances reconstruct deterministic blade quads in WGSL-ready records', () => {
  const field = createGrassMaterialFieldReference(IDENTITY);
  const expanded = createGrassRendererPacketsReference(field, DEMAND);
  const instanced = createGrassRendererInstancePacketsReference(field, DEMAND);
  const packet = instanced.packets[0];
  const expandedPacket = expanded.packets[0];

  assert.equal(packet.id, expandedPacket.id);
  assert.equal(packet.instance_kind, 'grass-blade-list');
  assert.equal(packet.instance_count, 16);
  assert.equal(packet.blade_count, 16);
  assert.ok(packet.instances instanceof Float32Array);
  assert.equal(packet.instances.length, 16 * 16);
  assert.equal(packet.vertices.length, 40);
  assert.equal(packet.indices.length, 6);
  assert.deepEqual([...packet.indices], [0, 1, 2, 0, 2, 3]);

  const record = packet.instances;
  const [x, y, z, height] = record;
  const [directionX, directionY, halfWidth] = record.slice(4, 7);
  const [leanX, leanY] = record.slice(8, 10);
  const template = packet.vertices;
  for (let vertex = 0; vertex < 4; vertex += 1) {
    const templateOffset = vertex * 10;
    const expandedOffset = vertex * 10;
    const side = template[templateOffset];
    const rise = template[templateOffset + 2];
    close(expandedPacket.vertices[expandedOffset], x + directionX * halfWidth * side + leanX * rise);
    close(expandedPacket.vertices[expandedOffset + 1], y + directionY * halfWidth * side + leanY * rise);
    close(expandedPacket.vertices[expandedOffset + 2], z + height * rise);
    assert.deepEqual(
      [...expandedPacket.vertices.slice(expandedOffset + 6, expandedOffset + 10)],
      [...record.slice(12, 16)],
    );
  }
});

test('instanced grass is byte-stable under refinement and reduces bounded upload', () => {
  const field = createGrassMaterialFieldReference(IDENTITY);
  const coarse = createGrassRendererInstancePacketsReference(field, {
    ...DEMAND,
    detailLevel: 2,
  });
  const refined = createGrassRendererInstancePacketsReference(field, DEMAND);
  const recreated = createGrassRendererInstancePacketsReference(
    createGrassMaterialFieldReference(IDENTITY),
    DEMAND,
  );
  const expanded = createGrassRendererPacketsReference(field, DEMAND);

  assert.equal(refined.packets[0].id, coarse.packets[0].id);
  assert.deepEqual(
    [...coarse.packets[0].instances],
    [...refined.packets[0].instances.slice(0, coarse.packets[0].instances.length)],
  );
  assert.deepEqual([...refined.packets[0].instances], [...recreated.packets[0].instances]);
  assert.equal(refined.instanceBytes, 16 * 64);
  assert.equal(refined.uploadBytes, 1_208);
  assert.ok(refined.uploadBytes < expanded.vertexBytes + expanded.indexBytes);
  assert.ok(refined.uploadBytes <= refined.packets.length * 184 + refined.bladeCount * 64);
});
