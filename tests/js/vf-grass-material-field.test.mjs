import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

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
  assert.deepEqual(first, {
    fieldVariation: 0.8275767911476568,
    patchVariation: -0.5268860254969965,
    surfaceVariation: -0.2157097563439967,
    coverage: 0.8093782915027848,
    bladeHeight: 0.495709104276328,
    roughness: 0.8220761283665791,
    baseColor: [
      0.18565425296905105,
      0.42548471244076647,
      0.08679321837886861,
      1,
    ],
  });
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
    assert.equal(packet.no_lighting, true);
    assert.ok(packet.vertices instanceof Float32Array);
    assert.ok(packet.indices instanceof Uint32Array);
    assert.equal(packet.vertices.length, packet.blade_count * 40);
    assert.equal(packet.indices.length, packet.blade_count * 6);
  }
});

test('grass refinement appends blades without changing established cell identity', () => {
  const field = createGrassMaterialFieldReference(IDENTITY);
  const common = { cells: [[0, 0]], footprint: 0.02 };
  const coarse = createGrassRendererPacketsReference(field, {
    ...common,
    detailLevel: 2,
    bladeBudget: 4,
  });
  const fine = createGrassRendererPacketsReference(field, {
    ...common,
    detailLevel: 5,
    bladeBudget: 16,
  });

  assert.equal(coarse.packets[0].id, fine.packets[0].id);
  assert.deepEqual(
    [...coarse.packets[0].vertices],
    [...fine.packets[0].vertices.slice(0, coarse.packets[0].vertices.length)],
  );
  assert.deepEqual(
    [...coarse.packets[0].indices],
    [...fine.packets[0].indices.slice(0, coarse.packets[0].indices.length)],
  );
});

test('grass demand stays bounded for distant or over-capacity working sets', () => {
  const field = createGrassMaterialFieldReference(IDENTITY);
  const distant = createGrassRendererPacketsReference(field, {
    cells: [[2_000_000_000, -2_000_000_000]],
    detailLevel: Number.MAX_SAFE_INTEGER,
    footprint: 0,
    bladeBudget: 1,
  });
  const empty = createGrassRendererPacketsReference(field, {
    cells: Array.from({ length: 4096 }, (_, index) => [index, 0]),
    detailLevel: 5,
    footprint: 0,
    bladeBudget: 0,
  });

  assert.equal(distant.bladeCount, 1);
  assert.equal(distant.vertexBytes + distant.indexBytes, 184);
  assert.equal(empty.bladeCount, 0);
  assert.equal(empty.packets.length, 0);
  assert.throws(() => createGrassRendererPacketsReference(field, {
    cells: Array.from({ length: 4097 }, (_, index) => [index, 0]),
    detailLevel: 0,
    footprint: 0,
    bladeBudget: 0,
  }), /exceeds 4096 cells/);
  assert.throws(() => createGrassRendererPacketsReference(field, {
    cells: [[0, 0]],
    detailLevel: 0,
    footprint: 0,
    bladeBudget: 65537,
  }), /exceeds 65536/);
});

test('offscreen grass fixture feeds demanded packets into the retained renderer', async () => {
  const html = await readFile(
    new URL('../fixtures/grass-material-field-smoke.html', import.meta.url),
    'utf8',
  );

  assert.match(html, /createGrassRendererPacketsReference/);
  assert.match(html, /mountDynamicGeomFrame/);
  assert.match(html, /__grassMaterialFieldEvidence/);
  assert.match(html, /bladeCount/);
});
