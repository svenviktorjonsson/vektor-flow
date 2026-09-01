import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import {
  evaluateWoodCutGgxWhiteFurnaceReference,
  evaluateWoodCutWhiteFurnaceReference,
} from '../../web/vf-ui/vf-wood-material-energy.mjs';
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
} from '../../web/vf-ui/vf-wood-volume-field.mjs';
import {
  packWoodCutPlaneGridReference,
} from '../../web/vf-ui/vf-wood-cut-plane-grid.mjs';
import {
  packWoodCutSurfacePacketReference,
} from '../../web/vf-ui/vf-wood-cut-surface-packet.mjs';
import {
  packWoodCutMaterialPacketReference,
} from '../../web/vf-ui/vf-wood-cut-material-packet.mjs';

const IDENTITY = Object.freeze({
  generator: 'vkf.conditioned',
  version: 1,
  seed: Object.freeze([0x1f83d9ab, 0x5be0cd19]),
  domain: 'material',
  hierarchy: Object.freeze(['world:boreal', 'forest:north-slope']),
  lod: 0,
  channel: 'population',
});

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
    normalRgba8: new Uint8ClampedArray([
      127, 127, 255, 255,
      127, 127, 255, 255,
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

function sha256(bytes) {
  return createHash('sha256')
    .update(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength))
    .digest('hex')
    .toUpperCase();
}

test('anisotropic GGX reference integrates the complete white-furnace hemisphere', () => {
  const material = Object.freeze({
    ...materialPacket(),
    imageWidth: 1,
    imageHeight: 1,
    baseColors: new Float32Array([0.8, 0.5, 0.2, 1]),
    normalRgba8: new Uint8ClampedArray([127, 127, 255, 255]),
    roughnessR8: new Uint8Array([128]),
  });
  const oracle = evaluateWoodCutGgxWhiteFurnaceReference(material, { sampleBudget: 1 });

  assert.equal(oracle.kind, 'wood-cut-ggx-white-furnace:v1');
  assert.strictEqual(oracle.sourceMaterial, material);
  assert.equal(oracle.sampleCount, 1);
  assert.ok(oracle.hemisphereSamples >= 4096);
  assert.deepEqual(oracle.profiles.map((profile) => profile.kind), [
    'isotropic-ggx',
    'anisotropic-ggx',
  ]);
  for (const profile of oracle.profiles) {
    assert.ok(profile.unitReflectorEnergy instanceof Float32Array);
    assert.ok(profile.dielectricSpecularEnergy instanceof Float32Array);
    assert.ok(profile.combinedEnergyRgb instanceof Float32Array);
    assert.equal(profile.unitReflectorEnergy.length, oracle.viewProbes.length);
    assert.equal(profile.combinedEnergyRgb.length, oracle.viewProbes.length * 3);
    assert.equal(profile.violations, 0);
    assert.ok(profile.minimumEnergy >= 0);
    assert.ok(profile.maximumEnergy <= 1);
    profile.unitReflectorEnergy.forEach((unitEnergy, index) => {
      assert.ok(unitEnergy >= profile.dielectricSpecularEnergy[index]);
      assert.ok(unitEnergy <= 1);
    });
  }
});

test('GGX furnace reports a bounded paired-quadrature convergence delta', () => {
  const material = Object.freeze({
    ...materialPacket(),
    imageWidth: 1,
    imageHeight: 1,
    baseColors: new Float32Array([0.8, 0.5, 0.2, 1]),
    normalRgba8: new Uint8ClampedArray([127, 127, 255, 255]),
    roughnessR8: new Uint8Array([128]),
  });
  const oracle = evaluateWoodCutGgxWhiteFurnaceReference(material, { sampleBudget: 1 });
  assert.ok(oracle.coarseHemisphereSamples >= 1024);
  for (const profile of oracle.profiles) {
    assert.ok(profile.maximumQuadratureDelta >= 0);
    assert.ok(profile.maximumQuadratureDelta <= 0.01);
  }
});

test('GGX anisotropy responds to tangent direction while isotropy remains rotation invariant', () => {
  const material = Object.freeze({
    ...materialPacket(),
    imageWidth: 1,
    imageHeight: 1,
    baseColors: new Float32Array([0.8, 0.5, 0.2, 1]),
    normalRgba8: new Uint8ClampedArray([127, 127, 255, 255]),
    roughnessR8: new Uint8Array([128]),
  });
  const oracle = evaluateWoodCutGgxWhiteFurnaceReference(material, { sampleBudget: 1 });
  const [isotropic, anisotropic] = oracle.profiles;

  assert.ok(Math.abs(
    isotropic.unitReflectorEnergy[1] - isotropic.unitReflectorEnergy[2],
  ) <= 1e-6);
  assert.ok(Math.abs(
    anisotropic.unitReflectorEnergy[1] - anisotropic.unitReflectorEnergy[2],
  ) >= 1e-3);
  assert.equal(isotropic.alphaX[0], isotropic.alphaY[0]);
  assert.ok(anisotropic.alphaX[0] > anisotropic.alphaY[0]);
});

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

test('filtered tangent normals feed the local-incidence energy reference', () => {
  const flat = materialPacket();
  const tilted = Object.freeze({
    ...materialPacket(),
    id: 'wood:test:tilted:2x1:material',
    normalRgba8: new Uint8ClampedArray([
      255, 127, 128, 255,
      127, 127, 255, 255,
    ]),
  });
  const flatOracle = evaluateWoodCutWhiteFurnaceReference(flat, { sampleBudget: 2 });
  const tiltedOracle = evaluateWoodCutWhiteFurnaceReference(tilted, { sampleBudget: 2 });

  assert.notEqual(tiltedOracle.meanLocalCosine, flatOracle.meanLocalCosine);
  assert.notDeepEqual(energyAt(tiltedOracle, 0, 0), energyAt(flatOracle, 0, 0));
  assert.equal(tiltedOracle.violations, 0);
});

test('every current end-grain and side-grain refinement level remains energy conserving', () => {
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
  const center = trunk.origin.map((origin, component) => (
    origin + trunk.axis[component] * trunk.length * 0.42
  ));
  const refinements = [
    { detailLevel: 0, footprint: 0.30 },
    { detailLevel: 1, footprint: 0.07 },
    { detailLevel: 2, footprint: 0 },
  ];
  const refinementEvidence = {};
  for (const refinement of refinements) {
    for (const [orientation, axisV, height] of [
      ['end-grain', trunk.radialV, trunk.radius * 1.2],
      ['side-grain', trunk.axis, trunk.length * 0.4],
    ]) {
      const grid = packWoodCutPlaneGridReference({
        field,
        coordinates,
        segmentIndex: 0,
        center,
        axisU: trunk.radialU,
        axisV,
        width: trunk.radius * 1.2,
        height,
        columns: 5,
        rows: 5,
        ...refinement,
        sampleBudget: 25,
      });
      const surface = packWoodCutSurfacePacketReference(grid, orientation);
      const material = packWoodCutMaterialPacketReference(surface);
      const oracle = evaluateWoodCutWhiteFurnaceReference(material, { sampleBudget: 25 });
      const ggxOracle = evaluateWoodCutGgxWhiteFurnaceReference(material, { sampleBudget: 25 });

      assert.equal(oracle.violations, 0);
      assert.ok(oracle.minimumEnergy >= 0);
      assert.ok(oracle.maximumEnergy <= 1);
      ggxOracle.profiles.forEach((profile) => {
        assert.equal(profile.violations, 0);
        assert.ok(profile.minimumEnergy >= 0);
        assert.ok(profile.maximumEnergy <= 1);
        assert.ok(profile.maximumQuadratureDelta <= 0.01);
      });
      refinementEvidence[`${refinement.detailLevel}:${orientation}`] = {
        normalRadius: material.normalFilterRadius,
        normal: sha256(material.normalRgba8),
        energy: sha256(oracle.energyRgb),
        ggxIsotropic: sha256(ggxOracle.profiles[0].combinedEnergyRgb),
        ggxAnisotropic: sha256(ggxOracle.profiles[1].combinedEnergyRgb),
      };
    }
  }
  assert.deepEqual(refinementEvidence, {
    '0:end-grain': {
      normalRadius: [1, 1],
      normal: '372C43A8FF89CC72A7A8CF53A9B2B6BEF55F7AFA376441249BC7F3238915CAA9',
      energy: '591DB2C18EA9E3AAD3BAC0AC16DD969D8BFDEB58455193C1F925E0B6D941C06E',
      ggxIsotropic: '4FB13768FB88FC54CB0147867914C0291F862BC9023B0925BA0794F5123E1E57',
      ggxAnisotropic: 'B12F958DA1A0F499C2F89CBED2F586DF9CBF7F1C9774BDF25D0D9E0E13D3DA54',
    },
    '0:side-grain': {
      normalRadius: [1, 0],
      normal: '372C43A8FF89CC72A7A8CF53A9B2B6BEF55F7AFA376441249BC7F3238915CAA9',
      energy: '591DB2C18EA9E3AAD3BAC0AC16DD969D8BFDEB58455193C1F925E0B6D941C06E',
      ggxIsotropic: '4FB13768FB88FC54CB0147867914C0291F862BC9023B0925BA0794F5123E1E57',
      ggxAnisotropic: 'B12F958DA1A0F499C2F89CBED2F586DF9CBF7F1C9774BDF25D0D9E0E13D3DA54',
    },
    '1:end-grain': {
      normalRadius: [0, 0],
      normal: '62381071B0DD79322A6768E7C8C1E3749B0774430DFD0F9B3B7321B972F5ACEA',
      energy: 'D244A0FBFE32936DAF7450AF3A7BE0365992E53425B9BB67E4E51CEF39E22C2F',
      ggxIsotropic: 'A22AFFFAD79892E008A65603E3FFDCBC262ADE55CEC8F35B625B5C2E3B0A0BCD',
      ggxAnisotropic: '5743273C8F6EE1A5ECDA8CE175564276D88E0DDB224FC0AA2C82034B6124C095',
    },
    '1:side-grain': {
      normalRadius: [0, 0],
      normal: 'A4DE96CFB543AFCB7870943FF69B5F5DBB8CA0D33F0573818F4C6C1A697822BE',
      energy: '27FA6629D19243A1051BC203F180D4177CA1445CFE13DAC321B1765E99021C55',
      ggxIsotropic: '81FA13131F379F4D151756FABDC2673C3A77DADCC071B95F62E12A7091304E57',
      ggxAnisotropic: 'D76DAC3666A0F12D86614474D1DF126BC9BF8645CF881AAFEB9D357FFC14E344',
    },
    '2:end-grain': {
      normalRadius: [0, 0],
      normal: '3509090CE388ECD8562F62586B6EC0154150BE71BA1561B9DACBA8A37247F2E3',
      energy: '2060F14A57FCED2F8E06DDA597E0334F6D0B3E3FCFE5A0FBF5E793A4B99DF2CA',
      ggxIsotropic: '25355A6CD12104F9467BAD02266261BE2BBEBCE11DF576D4A5DBDA45FA5FE3B5',
      ggxAnisotropic: '231A9BB17793391D7D8A374484AE605133D4423DC44C62ACDD92DD7B139990D3',
    },
    '2:side-grain': {
      normalRadius: [0, 0],
      normal: '84E44E512EA80E1E52EF126629FDC7FD98D18A50593CC45D9248436F1AEE6F66',
      energy: 'FE066CE5801A801EACEF16261BEB41B3480433D2257656356FC0128406BC60D2',
      ggxIsotropic: '0C4289B22FC8AAD38A31D7BB36FD29C6ACAA30B71B738BA42BA2E34670392E64',
      ggxAnisotropic: '718BC11D2CAE3433E322674EB0310BFE08AD0ABAB4699E63F45BC3C222A46DC5',
    },
  });
});
