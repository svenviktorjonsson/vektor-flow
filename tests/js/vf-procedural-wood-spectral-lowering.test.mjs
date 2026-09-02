import assert from "node:assert/strict";
import test from "node:test";

import {
  createForestPopulationReference,
  realizeForestPatchesReference,
} from "../../web/vf-ui/vf-forest-population.mjs";
import {
  createTreeGeometryPlannerReference,
  planTreeGeometryReference,
} from "../../web/vf-ui/vf-tree-geometry-plan.mjs";
import {
  lowerProceduralWoodSpectralRendererReference,
} from "../../web/vf-ui/vf-procedural-wood-spectral-lowering.mjs";
import {
  packWoodCutMaterialPacketReference,
} from "../../web/vf-ui/vf-wood-cut-material-packet.mjs";
import {
  packWoodCutPlaneGridReference,
} from "../../web/vf-ui/vf-wood-cut-plane-grid.mjs";
import {
  packWoodCutSurfacePacketReference,
} from "../../web/vf-ui/vf-wood-cut-surface-packet.mjs";
import {
  createWoodGrowthCoordinateFieldReference,
  realizeWoodGrowthCoordinatesReference,
} from "../../web/vf-ui/vf-wood-growth-coordinates.mjs";
import {
  createWoodPolarizationGpuConsumptionFixture,
  createWoodPolarizationGpuDescriptorReference,
} from "../../web/vf-ui/vf-wood-polarization-gpu.mjs";
import {
  evaluateWoodCutPolarizedSampleReference,
} from "../../web/vf-ui/vf-wood-polarization-sample.mjs";
import {
  createWoodVolumeFieldReference,
} from "../../web/vf-ui/vf-wood-volume-field.mjs";
import {
  reflectGgxPolarized,
} from "../helpers/vf-rough-polarization-reference.mjs";

const identity = {
  generator: "vkf.conditioned",
  version: 1,
  seed: [0x1f83d9ab, 0x5be0cd19],
  domain: "material",
  hierarchy: ["world:boreal", "forest:north-slope"],
  lod: 0,
  channel: "population",
};

function generatedWoodMaterial() {
  const forest = realizeForestPatchesReference(
    createForestPopulationReference(identity),
    { patches: [[-2, 3]], treeBudget: 32 },
  );
  const geometry = planTreeGeometryReference(
    createTreeGeometryPlannerReference(identity),
    forest,
    {
      treeIndices: [0],
      detailLevels: [2],
      primitiveBudget: 64,
    },
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
  return packWoodCutMaterialPacketReference(
    packWoodCutSurfacePacketReference(grid, "end-grain"),
  );
}

test("private lowering emits a versioned spectral descriptor", () => {
  const material = generatedWoodMaterial();
  const sample = evaluateWoodCutPolarizedSampleReference(material, {
    sampleIndex: 4,
    wavelengthsNm: [450, 600, 850],
    wavelengthBudget: 3,
    opticalConstants: {
      wavelengthsNm: [450, 550, 650, 850],
      n: [1.4, 1.6, 1.9, 2.2],
      k: [0.05, 0.2, 0.55, 0.9],
    },
    incidentStokes: [1.0, 1.0, 0.0, 0.0],
    nIncident: 1.0,
    geometricCosThetaIncident: 0.65,
    microfacetSampleCount: 128,
    polarizationTransport: reflectGgxPolarized,
  });
  const polarization = createWoodPolarizationGpuDescriptorReference(
    sample,
    { spectralSampleBudget: 3 },
  );
  const polarizationGpuOutput =
    createWoodPolarizationGpuConsumptionFixture(polarization).expected;
  const lowered = lowerProceduralWoodSpectralRendererReference(material, {
    polarization,
    polarizationGpuOutput,
    exposureStops: 1.0,
    triangleBudget: 8,
  });

  assert.equal(lowered.kind, "procedural-wood-spectral-lowering:v1");
  assert.strictEqual(lowered.sourceMaterial, material);
  assert.strictEqual(lowered.sourcePolarization, polarization);
  assert.equal(
    lowered.descriptor.kind,
    "wood-spectral-presentation-gpu:v1",
  );
  assert.equal(lowered.descriptor.version, 1);
  assert.strictEqual(
    lowered.rendererPacket.wood_spectral_presentation_gpu,
    lowered.descriptor,
  );
  assert.strictEqual(lowered.rendererPacket.sourceMaterial, material);
  assert.equal(lowered.rendererPacket.triangleCount, 8);
  assert.deepEqual(
    lowered.presentation.linearHdrRgb,
    [
      0.28695741478116155,
      0.18449568181825438,
      0.055252085955895036,
    ],
  );
  assert.equal(lowered.descriptor.byteLength, 1456);
  assert.deepEqual(
    lowered.descriptor.floats.slice(
      lowered.descriptor.woodOffsetFloats,
    ),
    polarization.floats,
  );
});
