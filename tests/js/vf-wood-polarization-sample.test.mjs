import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateWoodCutPolarizedSampleReference,
} from "../../web/vf-ui/vf-wood-polarization-sample.mjs";
import {
  adaptWoodPolarizationToRendererPartReference,
  createWoodPolarizationGpuDescriptorReference,
} from "../../web/vf-ui/vf-wood-polarization-gpu.mjs";
import {
  reflectGgxPolarized,
} from "../helpers/vf-rough-polarization-reference.mjs";
import {
  createForestPopulationReference,
  realizeForestPatchesReference,
} from "../../web/vf-ui/vf-forest-population.mjs";
import {
  createTreeGeometryPlannerReference,
  planTreeGeometryReference,
} from "../../web/vf-ui/vf-tree-geometry-plan.mjs";
import {
  createWoodGrowthCoordinateFieldReference,
  realizeWoodGrowthCoordinatesReference,
} from "../../web/vf-ui/vf-wood-growth-coordinates.mjs";
import {
  createWoodVolumeFieldReference,
} from "../../web/vf-ui/vf-wood-volume-field.mjs";
import {
  packWoodCutPlaneGridReference,
} from "../../web/vf-ui/vf-wood-cut-plane-grid.mjs";
import {
  packWoodCutSurfacePacketReference,
} from "../../web/vf-ui/vf-wood-cut-surface-packet.mjs";
import {
  packWoodCutMaterialPacketReference,
} from "../../web/vf-ui/vf-wood-cut-material-packet.mjs";

const tolerance = 1.0e-12;
const identity = Object.freeze({
  generator: "vkf.conditioned",
  version: 1,
  seed: Object.freeze([0x1f83d9ab, 0x5be0cd19]),
  domain: "material",
  hierarchy: Object.freeze(["world:boreal", "forest:north-slope"]),
  lod: 0,
  channel: "population",
});
const opticalConstants = Object.freeze({
  wavelengthsNm: Object.freeze([450, 550, 650, 850]),
  n: Object.freeze([1.4, 1.6, 1.9, 2.2]),
  k: Object.freeze([0.05, 0.2, 0.55, 0.9]),
});

function generatedWoodMaterial() {
  const forest = realizeForestPatchesReference(
    createForestPopulationReference(identity),
    { patches: [[-2, 3]], treeBudget: 32 },
  );
  const geometry = planTreeGeometryReference(
    createTreeGeometryPlannerReference(identity),
    forest,
    { treeIndices: [0], detailLevels: [2], primitiveBudget: 64 },
  );
  const coordinates = realizeWoodGrowthCoordinatesReference(
    createWoodGrowthCoordinateFieldReference(),
    geometry,
    { segmentBudget: 64 },
  );
  const trunk = coordinates.segments[0];
  const center = trunk.origin.map((origin, component) => (
    origin + trunk.axis[component] * trunk.length * 0.42
  ));
  const grid = packWoodCutPlaneGridReference({
    field: createWoodVolumeFieldReference(identity),
    coordinates,
    segmentIndex: 0,
    center,
    axisU: trunk.radialU,
    axisV: trunk.radialV,
    width: trunk.radius * 1.2,
    height: trunk.radius * 1.2,
    columns: 3,
    rows: 3,
    detailLevel: 2,
    footprint: 0,
    sampleBudget: 9,
  });
  const surface = packWoodCutSurfacePacketReference(grid, "end-grain");
  return packWoodCutMaterialPacketReference(surface);
}

test("generated wood roughness drives passive spectral polarization", () => {
  const material = generatedWoodMaterial();
  const request = {
    sampleIndex: 4,
    wavelengthsNm: [450, 600, 850],
    wavelengthBudget: 3,
    opticalConstants,
    incidentStokes: [1.0, 1.0, 0.0, 0.0],
    nIncident: 1.0,
    geometricCosThetaIncident: 0.65,
    microfacetSampleCount: 128,
    polarizationTransport: reflectGgxPolarized,
  };
  const result = evaluateWoodCutPolarizedSampleReference(material, request);
  const repeated = evaluateWoodCutPolarizedSampleReference(material, request);

  assert.deepEqual(repeated, result);
  assert.equal(result.kind, "wood-cut-polarized-sample:v1");
  assert.strictEqual(result.sourceMaterial, material);
  assert.equal(result.sampleIndex, 4);
  assert.equal(result.roughness, material.roughnessR8[4] / 255);
  assert.equal(result.spectralSamples.length, 3);
  assert.throws(
    () => evaluateWoodCutPolarizedSampleReference(material, {
      ...request,
      wavelengthBudget: 2,
    }),
    /wavelengths exceed wavelengthBudget/u,
  );
  assert.ok(result.localCosThetaIncident >= 0.0);
  assert.ok(result.localCosThetaIncident <= 1.0);
  assert.notDeepEqual(
    result.spectralSamples[0].refractiveIndex,
    result.spectralSamples.at(-1).refractiveIndex,
  );
  assert.notEqual(
    result.spectralSamples[0].stokes[0],
    result.spectralSamples.at(-1).stokes[0],
  );
  for (const sample of result.spectralSamples) {
    assert.ok(sample.stokes[0] >= -tolerance);
    assert.ok(sample.stokes[0] <= request.incidentStokes[0] + tolerance);
    assert.ok(sample.degreeOfPolarization < 1.0 - 1.0e-3);
    assert.ok(sample.degreeOfPolarization >= 0.0);
    assert.ok(sample.absorbedIntensity >= -tolerance);
    assert.ok(Math.abs(
      sample.stokes[0]
      + sample.absorbedIntensity
      - request.incidentStokes[0],
    ) <= tolerance);
  }
});

test("wood spectral Stokes samples retain their f32 GPU layout", () => {
  const material = generatedWoodMaterial();
  const sample = evaluateWoodCutPolarizedSampleReference(material, {
    sampleIndex: 4,
    wavelengthsNm: [450, 600, 850],
    wavelengthBudget: 3,
    opticalConstants,
    incidentStokes: [1.0, 1.0, 0.0, 0.0],
    nIncident: 1.0,
    geometricCosThetaIncident: 0.65,
    microfacetSampleCount: 128,
    polarizationTransport: reflectGgxPolarized,
  });
  const part = Object.freeze({
    id: "wood:cut:polarized",
    object_id: 71,
    type: "field_mesh",
    vertices: new Float32Array(30),
    indices: new Uint32Array([0, 1, 2]),
  });
  const adapted = adaptWoodPolarizationToRendererPartReference(
    part,
    sample,
    { spectralSampleBudget: 3 },
  );
  const descriptor = adapted.wood_polarization_gpu;
  const repeated = createWoodPolarizationGpuDescriptorReference(
    sample,
    { spectralSampleBudget: 3 },
  );

  assert.equal(adapted.id, part.id);
  assert.equal(adapted.object_id, part.object_id);
  assert.strictEqual(adapted.vertices, part.vertices);
  assert.strictEqual(adapted.indices, part.indices);
  assert.equal(descriptor.kind, "wood-polarization-gpu:v1");
  assert.strictEqual(descriptor.sourceSample, sample);
  assert.equal(descriptor.headerFloats, 4);
  assert.equal(descriptor.recordStrideFloats, 8);
  assert.equal(descriptor.spectralSampleCount, 3);
  assert.equal(descriptor.floats.length, 4 + 3 * 8);
  assert.equal(descriptor.byteLength, descriptor.floats.byteLength);
  assert.equal(descriptor.floats[3], Math.fround(sample.roughness));
  assert.throws(
    () => createWoodPolarizationGpuDescriptorReference(
      sample,
      { spectralSampleBudget: 2 },
    ),
    /samples exceed spectralSampleBudget/u,
  );
  for (let index = 0; index < sample.spectralSamples.length; index += 1) {
    const source = sample.spectralSamples[index];
    const offset = descriptor.headerFloats
      + index * descriptor.recordStrideFloats;
    assert.deepEqual(Array.from(descriptor.floats.slice(offset, offset + 8)), [
      Math.fround(source.wavelengthNm),
      Math.fround(sample.localCosThetaIncident),
      Math.fround(source.absorbedIntensity),
      Math.fround(source.degreeOfPolarization),
      ...source.stokes.map(Math.fround),
    ]);
  }
  assert.deepEqual(
    new Uint8Array(repeated.floats.buffer),
    new Uint8Array(descriptor.floats.buffer),
  );
});
