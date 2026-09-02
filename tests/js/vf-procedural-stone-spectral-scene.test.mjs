import assert from "node:assert/strict";
import test from "node:test";

import {
  createCoarseEllipsoidReference,
} from "../../web/vf-ui/vf-demand-refined-geometry.mjs";
import {
  createProceduralStoneSpectralSceneFixtureReference,
} from "../../web/vf-ui/vf-procedural-stone-spectral-scene.mjs";
import {
  adaptRockMaterialToRendererPacketReference,
  createRockMaterialFieldReference,
} from "../../web/vf-ui/vf-rock-material-field.mjs";
import {
  adaptEllipsoidWorkingSetToRetainedGeometryPacketsReference,
} from "../../web/vf-ui/vf-rock-renderer-packets.mjs";
import {
  updateEllipsoidRefinementWorkingSetReference,
} from "../../web/vf-ui/vf-refinement-working-set.mjs";

const IDENTITY = Object.freeze({
  generator: "vkf.conditioned",
  version: 1,
  seed: Object.freeze([0x01234567, 0x89abcdef]),
  domain: "material",
  hierarchy: Object.freeze(["world:alpine", "stone:released-scene"]),
  lod: 0,
  channel: "surface",
});

function generatedStoneMaterial() {
  const coarse = createCoarseEllipsoidReference({ radii: [1.4, 1.0, 0.8] });
  const working = updateEllipsoidRefinementWorkingSetReference(coarse, null, {
    demands: [],
    vertexBudget: 0,
    faceBudget: 0,
  });
  const [packet] = adaptEllipsoidWorkingSetToRetainedGeometryPacketsReference(
    working,
    null,
  ).packets;
  return adaptRockMaterialToRendererPacketReference(
    packet,
    createRockMaterialFieldReference(IDENTITY),
    {
      radii: coarse.radii,
      detailLevel: 4,
      footprint: 0.02,
    },
  );
}

test("stone geometry reuses bounded spectral GGX fragment transport", () => {
  const material = generatedStoneMaterial();
  const fixture = createProceduralStoneSpectralSceneFixtureReference(
    material,
    { width: 64, height: 64 },
  );
  const repeated = createProceduralStoneSpectralSceneFixtureReference(
    material,
    { width: 64, height: 64 },
  );

  assert.equal(fixture.kind, "procedural-stone-spectral-scene:v1");
  assert.strictEqual(fixture.sourceMaterial, material);
  assert.equal(fixture.vertexStrideBytes, 64);
  assert.equal(fixture.vertices.length, 6 * 16);
  assert.equal(fixture.indices.length, 8 * 3);
  assert.equal(fixture.distribution.sampleCount, 6);
  assert.ok(fixture.distribution.baseColorSpan > 0.01);
  assert.ok(fixture.distribution.roughnessSpan > 0.01);
  assert.ok(fixture.distribution.displacementSpan > 0.01);
  assert.ok(fixture.distribution.maximumVertexBytes <= 4_194_304);
  for (let vertex = 0; vertex < 6; vertex += 1) {
    for (let record = 0; record < 3; record += 1) {
      const offset = vertex * 16;
      const reflected = fixture.vertices[offset + 10 + record];
      const absorbed = fixture.vertices[offset + 13 + record];
      assert.ok(Math.abs(reflected + absorbed - 1.0) < 1.0e-6);
    }
  }
  assert.match(fixture.source, /ggx_distribution/u);
  assert.match(fixture.source, /spectral_visible_ratio/u);
  assert.deepEqual(repeated.vertices, fixture.vertices);
  assert.deepEqual(repeated.indices, fixture.indices);
  assert.deepEqual(repeated.fragmentUniforms, fixture.fragmentUniforms);
  assert.deepEqual(repeated.distribution, fixture.distribution);
});
