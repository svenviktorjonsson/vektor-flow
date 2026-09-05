import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createRoadCoordinateFieldReference,
  realizeRoadCoordinateCellsReference,
} from '../../web/vf-ui/vf-road-coordinate-field.mjs';
import {
  createRoadWearFieldReference,
  realizeRoadWearCellsReference,
} from '../../web/vf-ui/vf-road-wear-field.mjs';
import {
  measureRoadWearCorrelationReference,
} from '../../web/vf-ui/vf-road-wear-correlation-report.mjs';

const IDENTITY = Object.freeze({
  generator: 'vkf.conditioned',
  version: 1,
  seed: Object.freeze([0x3c6ef372, 0xa54ff53a]),
  domain: 'material',
  hierarchy: Object.freeze(['world:test', 'road:arterial-7']),
  lod: 0,
  channel: 'road',
});

const CELLS = Object.freeze(Array.from({ length: 512 }, (_, index) => (
  Object.freeze([Math.floor(index / 16), index % 16, 0])
)));

function report(cells) {
  const field = createRoadCoordinateFieldReference({
    origin: [10, 20, 3],
    forward: [1, 0, 0],
    up: [0, 0, 1],
    cellSize: [1, 0.25],
    longitudinalCells: 1_000_000_000,
    lateralCells: 64,
    layerThicknesses: [1, 2, 4],
  });
  const coordinates = realizeRoadCoordinateCellsReference(field, {
    cells,
    cellBudget: 512,
  });
  const wear = realizeRoadWearCellsReference(
    createRoadWearFieldReference(IDENTITY),
    coordinates,
    { sampleBudget: 512 },
  );
  return measureRoadWearCorrelationReference(wear);
}

test('road report pins shared geometry and appearance wear', () => {
  const forward = report(CELLS);
  const reversed = report([...CELLS].reverse());

  assert.deepEqual(reversed, forward);
  assert.equal(forward.kind, 'road-wear-correlation-report:v1');
  assert.equal(forward.sampleCount, 512);
  assert.deepEqual(Array.from(forward.means), [
    -0.015125182319025043,
    0.6018826069775969,
    0.09332467549433635,
  ]);
  assert.deepEqual(Array.from(forward.correlations), [
    0.9995883163946384,
    0.9960376500822952,
  ]);
  assert.ok(forward.correlations[0] > 0.99);
  assert.ok(forward.correlations[1] > 0.99);
  assert.equal(forward.vectorBytes, 40);
});
