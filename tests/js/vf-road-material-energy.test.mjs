import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createRoadConstructionFieldReference,
  realizeRoadConstructionCellsReference,
} from '../../web/vf-ui/vf-road-construction-field.mjs';
import {
  createRoadCoordinateFieldReference,
  realizeRoadCoordinateCellsReference,
} from '../../web/vf-ui/vf-road-coordinate-field.mjs';
import {
  evaluateRoadMaterialWhiteFurnaceReference,
} from '../../web/vf-ui/vf-road-material-energy.mjs';
import {
  createRoadWaterFieldReference,
  realizeRoadWaterCellsReference,
} from '../../web/vf-ui/vf-road-water-field.mjs';
import {
  createRoadWearFieldReference,
  realizeRoadWearCellsReference,
} from '../../web/vf-ui/vf-road-wear-field.mjs';

const IDENTITY = Object.freeze({
  generator: 'vkf.conditioned',
  version: 1,
  seed: Object.freeze([0x6a09e667, 0xbb67ae85]),
  domain: 'material',
  hierarchy: Object.freeze(['world:test', 'road:arterial-7']),
  lod: 0,
  channel: 'road',
});

function roadMaterials() {
  const coordinates = realizeRoadCoordinateCellsReference(
    createRoadCoordinateFieldReference({
      origin: [10, 20, 3],
      forward: [1, 0, 0],
      up: [0, 0, 1],
      cellSize: [1, 0.1],
      longitudinalCells: 1_000_000_000,
      lateralCells: 100,
      layerThicknesses: [1, 2, 4],
    }),
    {
      cells: [[0, 49, 0], [0, 5, 0], [1, 94, 0], [0, 5, 1]],
      cellBudget: 4,
    },
  );
  const construction = realizeRoadConstructionCellsReference(
    createRoadConstructionFieldReference({
      ...IDENTITY,
      channel: 'road-construction',
    }),
    coordinates,
    { sampleBudget: 4 },
  );
  const wear = realizeRoadWearCellsReference(
    createRoadWearFieldReference({ ...IDENTITY, channel: 'road-wear' }),
    coordinates,
    { sampleBudget: 4 },
  );
  const water = realizeRoadWaterCellsReference(
    createRoadWaterFieldReference({ ...IDENTITY, channel: 'road-water' }),
    wear,
    { sampleBudget: 4 },
  );
  return { construction, water };
}

function dielectricF0(ior) {
  return ((ior - 1) / (ior + 1)) ** 2;
}

test('road composition and water conserve white-furnace energy', () => {
  const { construction, water } = roadMaterials();
  const energy = evaluateRoadMaterialWhiteFurnaceReference(
    construction,
    water,
    { sampleBudget: 3 },
  );

  assert.equal(energy.kind, 'road-material-white-furnace:v1');
  assert.strictEqual(energy.sourceConstruction, construction);
  assert.strictEqual(energy.sourceWater, water);
  assert.equal(energy.sampleCount, 3);
  assert.equal(energy.truncated, true);
  assert.equal(energy.vectorBytes, 192);
  assert.deepEqual(energy.cosineProbes, [1, 0.75, 0.5, 0.25, 0]);
  assert.equal(energy.violations, 0);
  assert.ok(energy.minimumEnergy >= 0);
  assert.ok(energy.maximumEnergy <= 1);

  const aggregateF0 = dielectricF0(1.56);
  const binderF0 = dielectricF0(1.52);
  const waterF0 = dielectricF0(4 / 3);
  for (let sample = 0; sample < energy.sampleCount; sample += 1) {
    const aggregate = construction.material.aggregateFraction[sample];
    const binder = construction.material.binderFraction[sample];
    const dryF0 = aggregate * aggregateF0 + binder * binderF0;
    const coverage = water.material.waterCoverage[sample];
    const expectedF0 = dryF0 + coverage * (waterF0 - dryF0);
    assert.ok(Math.abs(energy.fresnelF0[sample] - expectedF0) < 1e-6);

    for (let probe = 0; probe < energy.cosineProbes.length; probe += 1) {
      const cosine = energy.cosineProbes[probe];
      const fresnel = expectedF0 + (1 - expectedF0) * (1 - cosine) ** 5;
      for (let channel = 0; channel < 3; channel += 1) {
        const albedo = water.material.albedo[sample * 3 + channel];
        const expected = fresnel + (1 - fresnel) * albedo;
        const offset = (sample * energy.cosineProbes.length + probe) * 3
          + channel;
        assert.ok(Math.abs(energy.energyRgb[offset] - expected) < 1e-6);
      }
    }
  }
});
