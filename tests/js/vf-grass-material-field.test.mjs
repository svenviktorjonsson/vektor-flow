import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createGrassMaterialFieldReference,
  createGrassRendererPacketsReference,
  sampleGrassMaterialReference,
} from '../../web/vf-ui/vf-grass-material-field.mjs';

const IDENTITY = Object.freeze({
  generator: 'vkf.conditioned',
  version: 1,
  seed: [0x01234567, 0x89abcdef],
  domain: 'material',
  hierarchy: ['world:temperate', 'grass-field:3'],
  lod: 0,
  channel: 'surface',
});

test('grass material samples deterministic field and patch variation on demand', () => {
  const field = createGrassMaterialFieldReference(IDENTITY);
  const options = { detailLevel: 4, footprint: 0.02 };
  const first = sampleGrassMaterialReference(field, [3.25, -1.5], options);
  const recreated = sampleGrassMaterialReference(
    createGrassMaterialFieldReference(IDENTITY),
    [3.25, -1.5],
    options,
  );

  assert.deepEqual(first, recreated);
  assert.equal(field.kind, 'grass-multiscale-field:v1');
  assert.equal(field.maxOctaves, 6);
  assert.ok(first.fieldVariation >= -1 && first.fieldVariation <= 1);
  assert.ok(first.patchVariation >= -1 && first.patchVariation <= 1);
  assert.ok(first.coverage >= 0 && first.coverage <= 1);
  assert.ok(first.bladeHeight >= 0.18 && first.bladeHeight <= 0.72);
  assert.ok(first.roughness >= 0.72 && first.roughness <= 0.98);
  assert.equal(first.baseColor.length, 4);
  assert.ok(Object.isFrozen(first));
  assert.ok(Object.isFrozen(first.baseColor));
});

test('only demanded grass cells materialize a bounded typed renderer working set', () => {
  const field = createGrassMaterialFieldReference(IDENTITY);
  const cells = [[2, -1], [0, 0], [1, 0], [-1, 1]];
  const options = {
    cells,
    detailLevel: 5,
    footprint: 0.02,
    bladeBudget: 17,
  };
  const forward = createGrassRendererPacketsReference(field, options);
  const reverse = createGrassRendererPacketsReference(field, {
    ...options,
    cells: [...cells].reverse(),
  });

  assert.equal(forward.bladeCount, 17);
  assert.equal(forward.vertexBytes + forward.indexBytes, 17 * 184);
  assert.ok(forward.packets.length <= cells.length);
  assert.deepEqual(
    forward.packets.map(({ id }) => id),
    reverse.packets.map(({ id }) => id),
  );
  assert.deepEqual(
    forward.packets.map(({ vertices }) => [...vertices]),
    reverse.packets.map(({ vertices }) => [...vertices]),
  );
  for (const packet of forward.packets) {
    assert.equal(packet.type, 'field_mesh');
    assert.ok(packet.vertices instanceof Float32Array);
    assert.ok(packet.indices instanceof Uint32Array);
    assert.equal(packet.vertices.length, packet.blade_count * 40);
    assert.equal(packet.indices.length, packet.blade_count * 6);
  }
});
