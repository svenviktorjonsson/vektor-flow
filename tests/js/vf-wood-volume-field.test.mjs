import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createForestPopulationReference,
  realizeForestPatchesReference,
} from '../../web/vf-ui/vf-forest-population.mjs';
import {
  createTreeGeometryPlannerReference,
  planTreeGeometryReference,
} from '../../web/vf-ui/vf-tree-geometry-plan.mjs';
import {
  createWoodGrowthCoordinateFieldReference,
  realizeWoodGrowthCoordinatesReference,
} from '../../web/vf-ui/vf-wood-growth-coordinates.mjs';
import {
  createWoodVolumeFieldReference,
  sampleWoodVolumeReference,
} from '../../web/vf-ui/vf-wood-volume-field.mjs';

const IDENTITY = Object.freeze({
  generator: 'vkf.conditioned',
  version: 1,
  seed: Object.freeze([0x1f83d9ab, 0x5be0cd19]),
  domain: 'material',
  hierarchy: Object.freeze(['world:boreal', 'forest:north-slope']),
  lod: 0,
  channel: 'population',
});

function pointOnSegment(segment, axial, radial) {
  return segment.origin.map((origin, component) => (
    origin + segment.axis[component] * axial + segment.radialU[component] * radial
  ));
}

test('transverse and longitudinal cuts sample one deterministic multiscale wood volume', () => {
  const forest = realizeForestPatchesReference(
    createForestPopulationReference(IDENTITY),
    { patches: [[-2, 3]], treeBudget: 32 },
  );
  const geometry = planTreeGeometryReference(
    createTreeGeometryPlannerReference(IDENTITY),
    forest,
    { treeIndices: [0], detailLevels: [2], primitiveBudget: 64 },
  );
  const coordinates = realizeWoodGrowthCoordinatesReference(
    createWoodGrowthCoordinateFieldReference(),
    geometry,
    { segmentBudget: 64 },
  );
  const field = createWoodVolumeFieldReference(IDENTITY);
  const trunk = coordinates.segments[0];
  const points = [-0.6, 0, 0.6].map((radiusFactor) => pointOnSegment(
    trunk,
    trunk.length * 0.42,
    trunk.radius * radiusFactor,
  ));
  const options = { detailLevel: 2, footprint: 0 };

  const transverse = points.map((point) => sampleWoodVolumeReference(
    field,
    coordinates,
    0,
    point,
    options,
  ));
  const longitudinal = [...points].reverse().map((point) => sampleWoodVolumeReference(
    field,
    coordinates,
    0,
    point,
    options,
  )).reverse();

  assert.deepEqual(longitudinal, transverse);
  assert.ok(transverse.every((sample, index) => sample === longitudinal[index]));
  assert.ok(transverse.every(({ kind }) => kind === 'wood-volume-sample:v1'));
  assert.ok(transverse.every(({ activeScales }) => activeScales === 3));
  assert.ok(transverse.every(({ baseColor }) => (
    baseColor.length === 4 && baseColor.every(Number.isFinite)
  )));
  assert.notEqual(transverse[0].ring, transverse[1].ring);
  assert.notEqual(transverse[0].fiber, transverse[2].fiber);
});

test('trunk and branch sample the same volume at their shared attachment', () => {
  const forest = realizeForestPatchesReference(
    createForestPopulationReference(IDENTITY),
    { patches: [[-2, 3]], treeBudget: 32 },
  );
  const geometry = planTreeGeometryReference(
    createTreeGeometryPlannerReference(IDENTITY),
    forest,
    { treeIndices: [0], detailLevels: [2], primitiveBudget: 64 },
  );
  const coordinates = realizeWoodGrowthCoordinatesReference(
    createWoodGrowthCoordinateFieldReference(),
    geometry,
    { segmentBudget: 64 },
  );
  const field = createWoodVolumeFieldReference(IDENTITY);
  const attachment = coordinates.segments[1].origin;
  const options = { detailLevel: 2, footprint: 0 };
  const trunk = sampleWoodVolumeReference(field, coordinates, 0, attachment, options);
  const branch = sampleWoodVolumeReference(field, coordinates, 1, attachment, options);

  assert.ok(Math.abs(trunk.growthCoordinates[2] - branch.growthCoordinates[2]) < 1e-6);
  assert.ok(Math.abs(trunk.ring - branch.ring) < 1e-6);
  assert.ok(Math.abs(trunk.ray - branch.ray) < 1e-6);
  assert.ok(Math.abs(trunk.fiber - branch.fiber) < 1e-6);
  assert.deepEqual(trunk.baseColor, branch.baseColor);
});
