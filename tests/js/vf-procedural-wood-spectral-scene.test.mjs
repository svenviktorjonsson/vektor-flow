import assert from "node:assert/strict";
import test from "node:test";

import {
  createProceduralWoodSpectralSceneFixtureReference,
} from "../../web/vf-ui/vf-procedural-wood-spectral-scene.mjs";

function loweredFixture() {
  const sourceMaterial = {
    baseColors: new Float32Array([
      0.7, 0.4, 0.2, 1.0,
      0.6, 0.3, 0.1, 1.0,
      0.5, 0.2, 0.1, 1.0,
      0.8, 0.5, 0.3, 1.0,
    ]),
  };
  return {
    kind: "procedural-wood-spectral-lowering:v1",
    sourceMaterial,
    sourcePolarization: {
      kind: "wood-polarization-gpu:v1",
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
  assert.equal(fixture.vertexStrideBytes, 20);
  assert.strictEqual(fixture.indices, lowering.rendererPacket.indices);
  assert.deepEqual(Array.from(fixture.vertices), [
    -0.8, -0.8, 0.7, 0.4, 0.2,
    0.8, -0.8, 0.6, 0.3, 0.1,
    -0.8, 0.8, 0.5, 0.2, 0.1,
    0.8, 0.8, 0.8, 0.5, 0.3,
  ].map(Math.fround));
  assert.deepEqual(Array.from(fixture.fragmentUniforms), [
    Math.fround(0.4),
    Math.fround(0.25),
    Math.fround(0.1),
    1.0,
    Math.fround(0.65),
    Math.fround(0.35),
    Math.fround(0.15),
    1.0,
  ]);
  assert.match(fixture.source, /vf_procedural_wood_vertex/u);
  assert.match(fixture.source, /vf_procedural_wood_fragment/u);
  assert.match(fixture.source, /base_color/u);
  assert.match(fixture.source, /reference_base_color/u);
});
