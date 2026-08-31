import test from 'node:test';
import assert from 'node:assert/strict';

import {
  adaptRockMaterialToRendererPacketReference,
  createRockMaterialFieldReference,
  sampleRockMaterialReference,
} from '../../web/vf-ui/vf-rock-material-field.mjs';
import {
  createCoarseEllipsoidReference,
} from '../../web/vf-ui/vf-demand-refined-geometry.mjs';
import {
  updateEllipsoidRefinementWorkingSetReference,
} from '../../web/vf-ui/vf-refinement-working-set.mjs';
import {
  adaptEllipsoidWorkingSetToRetainedGeometryPacketsReference,
} from '../../web/vf-ui/vf-rock-renderer-packets.mjs';

const IDENTITY = Object.freeze({
  generator: 'vkf.conditioned',
  version: 1,
  seed: Object.freeze([0x01234567, 0x89abcdef]),
  domain: 'material',
  hierarchy: Object.freeze(['world:alpine', 'rock:17']),
  lod: 0,
  channel: 'surface',
});

test('one shared geology field drives correlated rock material channels', () => {
  const field = createRockMaterialFieldReference(IDENTITY);
  const sample = sampleRockMaterialReference(field, [0.125, -0.375], {
    detailLevel: 2,
    footprint: 0.04,
  });
  const weathering = Math.max(0, Math.min(1, 0.5 + 0.5 * sample.geology));

  assert.equal(sample.weathering, weathering);
  assert.deepEqual(sample.baseColor, [
    0.22 + (0.55 - 0.22) * weathering,
    0.19 + (0.49 - 0.19) * weathering,
    0.15 + (0.4 - 0.15) * weathering,
    1,
  ]);
  assert.equal(sample.roughness, 0.92 - 0.34 * weathering);
  assert.equal(sample.displacement, 0.08 * sample.geology);
  assert.ok(Math.abs(Math.hypot(...sample.tangentNormal) - 1) < 1e-15);
  assert.ok(Object.isFrozen(field));
  assert.ok(Object.isFrozen(sample));
  assert.ok(Object.isFrozen(sample.baseColor));
  assert.ok(Object.isFrozen(sample.tangentNormal));
});

test('rock material derivative matches a pinned central-difference oracle', () => {
  const field = createRockMaterialFieldReference(IDENTITY);
  const options = { detailLevel: 2, footprint: 0.04 };
  const position = [0.125, -0.375];
  const sample = sampleRockMaterialReference(field, position, options);
  const step = 1e-4;
  const geologyAt = (u, v) => sampleRockMaterialReference(
    field,
    [u, v],
    options,
  ).geology;
  const oracle = [
    (geologyAt(position[0] + step, position[1])
      - geologyAt(position[0] - step, position[1])) / (2 * step),
    (geologyAt(position[0], position[1] + step)
      - geologyAt(position[0], position[1] - step)) / (2 * step),
  ];

  assert.equal(sample.geology, 0.1157007647847343);
  assert.deepEqual(sample.derivative, [
    -2.352305242111219,
    -2.107711252649358,
  ]);
  assert.deepEqual(sample.derivative, oracle);
  assert.deepEqual(sample.tangentNormal, [
    0.36808735109403024,
    0.3298134264082471,
    0.8693300901990175,
  ]);
});

test('footprint filtering keeps shared surface samples stable across detail levels', () => {
  const field = createRockMaterialFieldReference(IDENTITY);
  const position = [0.125, -0.375];
  const coarse = sampleRockMaterialReference(field, position, {
    detailLevel: 0,
    footprint: 0.5,
  });
  const refined = sampleRockMaterialReference(field, position, {
    detailLevel: 5,
    footprint: 0.5,
  });
  const visibleFine = sampleRockMaterialReference(field, position, {
    detailLevel: 5,
    footprint: 0.01,
  });
  const extremeDetail = sampleRockMaterialReference(field, position, {
    detailLevel: Number.MAX_SAFE_INTEGER,
    footprint: 0.01,
  });

  assert.deepEqual(refined, coarse);
  assert.equal(coarse.geology, -0.2912937415105119);
  assert.equal(visibleFine.geology, 0.12466605886703269);
  assert.notEqual(visibleFine.geology, coarse.geology);
  assert.deepEqual(extremeDetail, visibleFine);
  assert.equal(field.maxOctaves, 6);
});

test('rock material demand is order and chunk independent without a surface grid', () => {
  const positions = Array.from({ length: 64 }, (_, index) => [
    ((index * 37) % 101) / 50 - 1,
    ((index * index * 17) % 103) / 51 - 1,
  ]);
  const options = { detailLevel: 4, footprint: 0.02 };
  const sample = (field, position) => sampleRockMaterialReference(
    field,
    position,
    options,
  );
  const field = createRockMaterialFieldReference(IDENTITY);
  const expected = positions.map((position) => sample(field, position));
  const reversed = new Map(
    [...positions].reverse().map((position) => [
      position.join(':'),
      sample(field, position),
    ]),
  );
  const chunks = [positions.slice(0, 5), positions.slice(5, 47), positions.slice(47)];
  const recreated = createRockMaterialFieldReference(IDENTITY);

  assert.deepEqual(
    positions.map((position) => reversed.get(position.join(':'))),
    expected,
  );
  assert.deepEqual(
    chunks.flatMap((chunk) => chunk.map((position) => sample(recreated, position))),
    expected,
  );
  assert.equal(
    sample(field, [1_000_000.25, -1_000_000.75]).geology,
    sample(recreated, [1_000_000.25, -1_000_000.75]).geology,
  );
});

test('rock material channels adapt into existing retained renderer packets', () => {
  const coarse = createCoarseEllipsoidReference({ radii: [3, 2, 1.5] });
  const working = updateEllipsoidRefinementWorkingSetReference(coarse, null, {
    demands: [],
    vertexBudget: 0,
    faceBudget: 0,
  });
  const [source] = adaptEllipsoidWorkingSetToRetainedGeometryPacketsReference(
    working,
    null,
  ).packets;
  const field = createRockMaterialFieldReference(IDENTITY);
  const material = adaptRockMaterialToRendererPacketReference(source, field, {
    radii: coarse.radii,
    detailLevel: 0,
    footprint: 0.1,
  });

  assert.equal(material.id, source.id);
  assert.equal(material.object_id, source.object_id);
  assert.strictEqual(material.indices, source.indices);
  assert.notStrictEqual(material.vertices, source.vertices);
  assert.equal(material.vertices.length, source.vertices.length);
  assert.deepEqual(Array.from(source.vertices.slice(0, 10)), [
    3, 0, 0, 1, 0, 0,
    0.46000000834465027,
    0.41999998688697815,
    0.36000001430511475,
    1,
  ]);
  assert.equal(material.material_channels.roughness.length, 6);
  assert.equal(material.material_channels.displacement.length, 6);
  assert.equal(material.material_channels.surfaceCoordinates.length, 12);
  assert.ok(material.vertices[0] !== source.vertices[0]);
  assert.ok(material.specular_strength > 0 && material.specular_strength < 1);
});

test('shared rock vertices keep identical filtered material across packet detail levels', () => {
  const coarse = createCoarseEllipsoidReference({ radii: [3, 2, 1.5] });
  const demand = Object.freeze({
    face: 'face:+x:+y:+z',
    silhouette: true,
    silhouetteEdges: Object.freeze([]),
    silhouetteErrorPixels: 40,
    projectedErrorPixels: 40,
    errorBoundPixels: 40,
  });
  const working = updateEllipsoidRefinementWorkingSetReference(coarse, null, {
    demands: [demand],
    vertexBudget: 1,
    faceBudget: 3,
  });
  const [coarseSource, detailSource] = (
    adaptEllipsoidWorkingSetToRetainedGeometryPacketsReference(working, null).packets
  );
  const field = createRockMaterialFieldReference(IDENTITY);
  const adapt = (packet, detailLevel) => adaptRockMaterialToRendererPacketReference(
    packet,
    field,
    { radii: coarse.radii, detailLevel, footprint: 0.5 },
  );
  const detailMaterial = adapt(detailSource, 1);
  const coarseMaterial = adapt(coarseSource, 0);
  const coarseIndex = coarseMaterial.vertex_ids.indexOf('vertex:+x');
  const detailIndex = detailMaterial.vertex_ids.indexOf('vertex:+x');

  assert.deepEqual(
    Array.from(detailMaterial.vertices.slice(detailIndex * 10, detailIndex * 10 + 10)),
    Array.from(coarseMaterial.vertices.slice(coarseIndex * 10, coarseIndex * 10 + 10)),
  );
  assert.deepEqual(
    Array.from(detailMaterial.material_channels.surfaceCoordinates.slice(
      detailIndex * 2,
      detailIndex * 2 + 2,
    )),
    Array.from(coarseMaterial.material_channels.surfaceCoordinates.slice(
      coarseIndex * 2,
      coarseIndex * 2 + 2,
    )),
  );
  assert.equal(
    detailMaterial.material_channels.roughness[detailIndex],
    coarseMaterial.material_channels.roughness[coarseIndex],
  );
});
