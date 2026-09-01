import test from 'node:test';
import assert from 'node:assert/strict';

import {
  evaluateWoodCutWhiteFurnaceReference,
} from '../../web/vf-ui/vf-wood-material-energy.mjs';

function materialPacket() {
  return Object.freeze({
    kind: 'wood-cut-material-packet:v1',
    id: 'wood:test:end-grain:2x1:material',
    imageWidth: 2,
    imageHeight: 1,
    baseColors: new Float32Array([
      0.8, 0.5, 0.2, 1,
      1.0, 1.0, 1.0, 1,
    ]),
    roughnessR8: new Uint8Array([96, 224]),
  });
}

function energyAt(oracle, sample, probe) {
  const offset = (sample * oracle.cosineProbes.length + probe) * 3;
  return Array.from(oracle.energyRgb.slice(offset, offset + 3));
}

function near(actual, expected, tolerance = 1e-6) {
  assert.equal(actual.length, expected.length);
  actual.forEach((value, index) => {
    assert.ok(Math.abs(value - expected[index]) <= tolerance, `${value} != ${expected[index]}`);
  });
}

test('wood dielectric partition stays inside the white-furnace energy budget', () => {
  const material = materialPacket();
  const oracle = evaluateWoodCutWhiteFurnaceReference(material, { sampleBudget: 2 });

  assert.equal(oracle.kind, 'wood-cut-white-furnace:v1');
  assert.strictEqual(oracle.sourceMaterial, material);
  assert.deepEqual(oracle.cosineProbes, [1, 0.75, 0.5, 0.25, 0]);
  assert.ok(oracle.energyRgb instanceof Float32Array);
  assert.equal(oracle.energyRgb.length, 2 * 5 * 3);
  assert.equal(oracle.vectorBytes, oracle.energyRgb.byteLength);
  assert.equal(oracle.violations, 0);
  assert.ok(oracle.minimumEnergy >= 0);
  assert.ok(oracle.maximumEnergy <= 1);
  near(energyAt(oracle, 0, 0), [0.808, 0.52, 0.232]);
  near(energyAt(oracle, 0, 4), [1, 1, 1]);
  near(energyAt(oracle, 1, 0), [1, 1, 1]);
});

test('white-furnace evaluation is retained and rejects over-budget material before allocation', () => {
  const material = materialPacket();
  const first = evaluateWoodCutWhiteFurnaceReference(material, { sampleBudget: 2 });
  const retained = evaluateWoodCutWhiteFurnaceReference(material, { sampleBudget: 2 });

  assert.strictEqual(retained, first);
  assert.strictEqual(retained.energyRgb, first.energyRgb);
  assert.throws(
    () => evaluateWoodCutWhiteFurnaceReference(material, { sampleBudget: 1 }),
    /exceeds sampleBudget/,
  );
});
