import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  evaluateWoodCutPolarizedSampleReference,
} from "../../web/vf-ui/vf-wood-polarization-sample.mjs";
import {
  WOOD_POLARIZATION_CONSUMER_WGSL,
  adaptWoodPolarizationToRendererPartReference,
  createWoodPolarizationGpuConsumptionFixture,
  createWoodPolarizationGpuDescriptorReference,
  verifyWoodPolarizationGpuConsumption,
} from "../../web/vf-ui/vf-wood-polarization-gpu.mjs";
import {
  integrateWoodPolarizationVisibleReference,
} from "../../web/vf-ui/vf-wood-polarization-visible.mjs";
import {
  presentWoodPolarizationVisibleReference,
} from "../../web/vf-ui/vf-wood-polarization-presentation.mjs";
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

test("WGSL consumer exposes bounded reflected RGB and Stokes energy", () => {
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
  const descriptor = createWoodPolarizationGpuDescriptorReference(
    sample,
    { spectralSampleBudget: 3 },
  );
  const fixture = createWoodPolarizationGpuConsumptionFixture(descriptor);
  const verified = verifyWoodPolarizationGpuConsumption(
    fixture,
    fixture.expected,
  );

  assert.strictEqual(fixture.inputFloats, descriptor.floats);
  assert.equal(fixture.outputStrideFloats, 8);
  assert.equal(fixture.violations, 0);
  assert.deepEqual(verified, {
    matched: true,
    records: 3,
    maxAbsoluteError: 0,
  });
  assert.match(WOOD_POLARIZATION_CONSUMER_WGSL, /array<vec4<f32>>/u);
  assert.match(fixture.source, /@compute\s+@workgroup_size\(64\)/u);
  for (let index = 0; index < descriptor.spectralSampleCount; index += 1) {
    const output = fixture.expected.slice(index * 8, index * 8 + 8);
    const reflectedIntensity = output[3];
    const polarizedMagnitude = Math.hypot(output[4], output[5], output[6]);
    assert.ok(reflectedIntensity >= -1.0e-6);
    assert.ok(polarizedMagnitude <= reflectedIntensity + 1.0e-6);
    assert.ok(Math.abs(
      reflectedIntensity
      + output[7]
      - 1.0,
    ) <= 1.0e-6);
  }
  assert.deepEqual(
    Array.from(fixture.expected.slice(2 * 8, 2 * 8 + 3)),
    [0.0, 0.0, 0.0],
  );
  assert.ok(fixture.expected[0] > 0.0);
  assert.ok(fixture.expected[1] > 0.0);
  assert.ok(fixture.expected[2] > 0.0);

  const corrupted = fixture.expected.slice();
  corrupted[4] = corrupted[3] + 0.1;
  assert.equal(
    verifyWoodPolarizationGpuConsumption(fixture, corrupted).matched,
    false,
  );
});

test("polarized wood GPU records integrate to passive visible color", () => {
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
  const descriptor = createWoodPolarizationGpuDescriptorReference(
    sample,
    { spectralSampleBudget: 3 },
  );
  const gpu = createWoodPolarizationGpuConsumptionFixture(descriptor);
  const visible = integrateWoodPolarizationVisibleReference(
    descriptor,
    gpu.expected,
  );
  const repeated = integrateWoodPolarizationVisibleReference(
    descriptor,
    gpu.expected,
  );

  assert.deepEqual(repeated, visible);
  assert.equal(visible.kind, "wood-polarization-visible:v1");
  assert.equal(visible.color.kind, "spectral-visible-color:v1");
  assert.ok(visible.color.linearRgb.some((channel) => channel > 0.0));
  assert.ok(visible.reflectedInfraredRadianceIntegral > 0.0);
  assert.ok(visible.absorbedInfraredRadianceIntegral > 0.0);
  assert.ok(visible.maxSampleEnergyError <= 1.0e-6);
  assert.ok(Math.abs(
    visible.reflectedVisibleRadianceIntegral
      + visible.absorbedVisibleRadianceIntegral
      - visible.incidentVisibleRadianceIntegral,
  ) <= tolerance);
  assert.ok(Math.abs(
    visible.reflectedInfraredRadianceIntegral
      + visible.absorbedInfraredRadianceIntegral
      - visible.incidentInfraredRadianceIntegral,
  ) <= tolerance);

  const energyCreating = gpu.expected.slice();
  energyCreating[3] = 1.1;
  assert.throws(
    () => integrateWoodPolarizationVisibleReference(
      descriptor,
      energyCreating,
    ),
    /failed parity/u,
  );
});

test("wood spectral HDR is tone mapped only for presentation", () => {
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
  const descriptor = createWoodPolarizationGpuDescriptorReference(
    sample,
    { spectralSampleBudget: 3 },
  );
  const gpu = createWoodPolarizationGpuConsumptionFixture(descriptor);
  const visible = integrateWoodPolarizationVisibleReference(
    descriptor,
    gpu.expected,
  );
  const base = presentWoodPolarizationVisibleReference(
    visible,
    { exposureStops: 0.0 },
  );
  const brighter = presentWoodPolarizationVisibleReference(
    visible,
    { exposureStops: 2.0 },
  );

  assert.strictEqual(base.sourceVisible, visible);
  assert.deepEqual(base.linearHdrRgb, visible.color.unclippedLinearRgb);
  assert.notStrictEqual(base.displayLinearRgb, base.linearHdrRgb);
  for (let channel = 0; channel < 3; channel += 1) {
    assert.ok(Number.isFinite(base.displayLinearRgb[channel]));
    assert.ok(base.displayLinearRgb[channel] >= 0.0);
    assert.ok(base.displayLinearRgb[channel] < 1.0);
    assert.ok(
      brighter.displayLinearRgb[channel]
        >= base.displayLinearRgb[channel],
    );
  }

  const neutral = presentWoodPolarizationVisibleReference({
    color: { unclippedLinearRgb: [4.0, 4.0, 4.0] },
  }, { exposureStops: 0.0 });
  assert.equal(neutral.displayLinearRgb[0], neutral.displayLinearRgb[1]);
  assert.equal(neutral.displayLinearRgb[1], neutral.displayLinearRgb[2]);

  const colored = presentWoodPolarizationVisibleReference({
    color: { unclippedLinearRgb: [4.0, 2.0, 1.0] },
  }, { exposureStops: 0.0 });
  assert.equal(
    colored.displayLinearRgb[0] / colored.displayLinearRgb[1],
    2.0,
  );
  assert.equal(
    colored.displayLinearRgb[1] / colored.displayLinearRgb[2],
    2.0,
  );

  const highlight = presentWoodPolarizationVisibleReference({
    color: { unclippedLinearRgb: [-0.25, 1.0e12, 5.0e11] },
  }, { exposureStops: 16.0 });
  assert.deepEqual(highlight.linearHdrRgb, [-0.25, 1.0e12, 5.0e11]);
  assert.equal(highlight.displayLinearRgb[0], 0.0);
  assert.ok(highlight.displayLinearRgb.every(Number.isFinite));
  assert.ok(highlight.displayLinearRgb.every((channel) => channel < 1.0));
});

test(
  "headless fixture consumes polarized wood records through WebGPU",
  async () => {
  const html = await readFile(
    new URL(
      "../fixtures/wood-polarization-gpu-consumption-smoke.html",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(html, /createComputePipelineAsync/u);
  assert.match(html, /vf_wood_polarization_consume/u);
  assert.match(html, /mapAsync\(GPUMapMode\.READ\)/u);
  assert.match(html, /verifyWoodPolarizationGpuConsumption/u);
  assert.match(html, /integrateWoodPolarizationVisibleReference/u);
  assert.match(html, /presentWoodPolarizationVisibleReference/u);
  assert.match(html, /__woodPolarizationGpuEvidence/u);
  },
);
