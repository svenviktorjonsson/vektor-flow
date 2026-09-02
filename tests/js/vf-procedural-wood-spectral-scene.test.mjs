import assert from "node:assert/strict";
import test from "node:test";

import {
  createProceduralWoodSpectralSceneFixtureReference,
  evaluateProceduralWoodAngularResponseReference,
  evaluateProceduralWoodSpectralRatioReference,
} from "../../web/vf-ui/vf-procedural-wood-spectral-scene.mjs";

function loweredFixture() {
  const sourceMaterial = {
    baseColors: new Float32Array([
      0.65, 0.35, 0.15, 1.0,
      0.6, 0.3, 0.1, 1.0,
      0.5, 0.2, 0.1, 1.0,
      0.8, 0.5, 0.3, 1.0,
    ]),
    normalRgba8: new Uint8ClampedArray([
      128, 128, 255, 255,
      128, 128, 255, 255,
      128, 128, 255, 255,
      128, 128, 255, 255,
    ]),
  };
  return {
    kind: "procedural-wood-spectral-lowering:v1",
    sourceMaterial,
    sourcePolarization: {
      kind: "wood-polarization-gpu:v1",
      headerFloats: 4,
      recordStrideFloats: 8,
      spectralSampleCount: 3,
      floats: new Float32Array([
        0.65, 0.35, 0.15, 0.2,
        450, 0.65, 0.8, 0.5, 0.2, 0.1, 0.0, 0.0,
        600, 0.65, 0.5, 0.5, 0.5, 0.1, 0.0, 0.0,
        850, 0.65, 0.7, 0.5, 0.3, 0.1, 0.0, 0.0,
      ]),
      sourceSample: {
        sourceMaterial,
        baseColor: [0.65, 0.35, 0.15],
      },
    },
    presentation: {
      kind: "wood-polarization-presentation:v1",
      displayLinearRgb: [0.4, 0.25, 0.1],
    },
    rendererPacket: {
      kind: "wood-cut-material-triangle-packet:v1",
      sourceMaterial,
      vertexCount: 4,
      triangleCount: 2,
      positions: new Float32Array([
        -2, -1, 3,
        2, -1, 3,
        -2, 1, 3,
        2, 1, 3,
      ]),
      indices: new Uint32Array([0, 1, 2, 2, 1, 3]),
      normalRgba8: sourceMaterial.normalRgba8,
      ggxLobe: {
        alphaX: new Float32Array([0.2, 0.3, 0.4, 0.5]),
        alphaY: new Float32Array([0.1, 0.15, 0.2, 0.25]),
      },
      tangentFrame: {
        tangent: [1, 0, 0],
        bitangent: [0, 1, 0],
        normal: [0, 0, 1],
        handedness: 1,
      },
    },
  };
}

test("spectral scene fixture projects bounded procedural geometry", () => {
  const lowering = loweredFixture();
  const fixture = createProceduralWoodSpectralSceneFixtureReference(
    lowering,
    { width: 64, height: 32 },
  );

  assert.equal(fixture.kind, "procedural-wood-spectral-scene:v1");
  assert.strictEqual(fixture.sourceLowering, lowering);
  assert.equal(fixture.width, 64);
  assert.equal(fixture.height, 32);
  assert.equal(fixture.format, "rgba8unorm-srgb");
  assert.equal(fixture.bytesPerRow, 256);
  assert.equal(fixture.outputByteLength, 8192);
  assert.equal(fixture.vertexStrideBytes, 64);
  assert.strictEqual(fixture.indices, lowering.rendererPacket.indices);
  assert.equal(fixture.vertices.length, 64);
  assert.deepEqual(Array.from(fixture.vertices.slice(0, 5)), [
    -0.8, -0.8, 0.65, 0.35, 0.15,
  ].map(Math.fround));
  assert.ok(Math.abs(fixture.vertices[5]) < 0.004);
  assert.ok(Math.abs(fixture.vertices[6]) < 0.004);
  assert.ok(fixture.vertices[7] > 0.999);
  assert.equal(fixture.vertices[8], Math.fround(0.2));
  assert.equal(fixture.vertices[9], Math.fround(0.1));
  assert.deepEqual(Array.from(fixture.vertices.slice(10, 16)), [
    0.2, 0.5, 0.3,
    0.8, 0.5, 0.7,
  ].map(Math.fround));
  for (let record = 0; record < 3; record += 1) {
    assert.ok(Math.abs(
      fixture.vertices[10 + record]
      + fixture.vertices[13 + record]
      - 1.0
    ) < 1.0e-6);
  }
  for (let vertex = 0; vertex < 4; vertex += 1) {
    for (let record = 0; record < 3; record += 1) {
      const offset = vertex * 16;
      const reflected = fixture.vertices[offset + 10 + record];
      const absorbed = fixture.vertices[offset + 13 + record];
      assert.ok(reflected >= 0.0 && reflected <= 1.0);
      assert.ok(absorbed >= 0.0 && absorbed <= 1.0);
      assert.ok(Math.abs(reflected + absorbed - 1.0) < 1.0e-6);
    }
  }
  assert.deepEqual(Array.from(fixture.fragmentUniforms), [
    Math.fround(0.4),
    Math.fround(0.25),
    Math.fround(0.1),
    1.0,
    Math.fround(0.65),
    Math.fround(0.35),
    Math.fround(0.15),
    1.0,
    Math.fround(0.35),
    Math.fround(0.25),
    Math.fround(Math.sqrt(0.815)),
    0.0,
    0.0,
    0.0,
    1.0,
    0.0,
    450.0,
    600.0,
    850.0,
    0.0,
    Math.fround(0.2),
    Math.fround(0.5),
    Math.fround(0.3),
    0.0,
  ]);
  assert.match(fixture.source, /vf_procedural_wood_vertex/u);
  assert.match(fixture.source, /vf_procedural_wood_fragment/u);
  assert.match(fixture.source, /base_color/u);
  assert.match(fixture.source, /reference_base_color/u);
  assert.match(fixture.source, /ggx_distribution/u);
  assert.match(fixture.source, /masking_shadowing/u);
  assert.match(fixture.source, /spectral_reflected/u);
  assert.match(fixture.source, /spectral_absorbed/u);
  assert.match(fixture.source, /spectral_visible_ratio/u);
});

test("fragment spectrum excludes infrared and enforces passive energy", () => {
  const common = {
    wavelengths: [450, 600, 850],
    referenceReflected: [0.2, 0.5, 0.3],
    absorbed: [0.8, 0.5, 0.7],
  };
  const baseline = evaluateProceduralWoodSpectralRatioReference({
    ...common,
    reflected: [0.2, 0.5, 0.3],
  });
  const changedInfrared = evaluateProceduralWoodSpectralRatioReference({
    ...common,
    reflected: [0.2, 0.5, 0.9],
    absorbed: [0.8, 0.5, 0.1],
  });
  assert.equal(baseline.visibleRatio, 1.0);
  assert.equal(changedInfrared.visibleRatio, baseline.visibleRatio);
  assert.equal(changedInfrared.maximumEnergy, 1.0);
  assert.equal(changedInfrared.passiveScale, 1.0);

  const bounded = evaluateProceduralWoodSpectralRatioReference({
    ...common,
    reflected: [0.4, 1.0, 0.3],
  });
  assert.ok(bounded.maximumEnergy > 1.0);
  assert.ok(bounded.passiveScale < 1.0);
  assert.ok(
    bounded.maximumEnergy * bounded.passiveScale <= 1.0 + 1.0e-12
  );
});

test("angular GGX and diffuse response stays inside white furnace", () => {
  const thetaSamples = 32;
  const phiSamples = 64;
  const solidAngle = 2.0 * Math.PI / (thetaSamples * phiSamples);
  let furnaceEnergy = 0.0;
  for (let theta = 0; theta < thetaSamples; theta += 1) {
    const cosine = (theta + 0.5) / thetaSamples;
    const sine = Math.sqrt(1.0 - cosine * cosine);
    for (let phi = 0; phi < phiSamples; phi += 1) {
      const azimuth = 2.0 * Math.PI * (phi + 0.5) / phiSamples;
      const response = evaluateProceduralWoodAngularResponseReference({
        normal: [0, 0, 1],
        alphaX: 0.35,
        alphaY: 0.2,
        lightDirection: [
          sine * Math.cos(azimuth),
          sine * Math.sin(azimuth),
          cosine,
        ],
        viewDirection: [0, 0, 1],
      });
      assert.ok(response.outgoing >= 0.0);
      assert.ok(response.fresnel >= 0.0 && response.fresnel <= 1.0);
      assert.ok(Math.abs(
        response.fresnel + response.diffuseWeight - 1.0
      ) < 1.0e-12);
      furnaceEnergy += response.outgoing * solidAngle;
    }
  }
  assert.ok(furnaceEnergy > 0.9);
  assert.ok(furnaceEnergy <= 1.0 + 2.0e-3);
});
