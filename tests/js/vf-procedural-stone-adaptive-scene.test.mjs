import assert from "node:assert/strict";
import test from "node:test";

import {
  createProceduralStoneAdaptiveSceneReference,
} from "../../web/vf-ui/vf-procedural-stone-adaptive-scene.mjs";

const IDENTITY = Object.freeze({
  generator: "vkf.conditioned",
  version: 1,
  seed: Object.freeze([0x01234567, 0x89abcdef]),
  domain: "material",
  hierarchy: Object.freeze(["world:alpine", "stone:adaptive-scene"]),
  lod: 0,
  channel: "surface",
});

const CAMERA = Object.freeze({
  eye: Object.freeze([8, 0, 0]),
  target: Object.freeze([0, 0, 0]),
  up: Object.freeze([0, 0, 1]),
  verticalFovRadians: Math.PI / 3,
  viewportHeight: 1080,
});

test("stone scene refines projected demand within RAM", () => {
  const scene = createProceduralStoneAdaptiveSceneReference({
    identity: IDENTITY,
    radii: [1.4, 1.0, 0.8],
    detailVertexBudget: 4,
    ramBudgetBytes: 812,
    materialDetailLevel: 4,
    footprint: 0.02,
  });
  const coarse = scene.snapshot();

  assert.equal(coarse.kind, "procedural-stone-adaptive-scene:v1");
  assert.equal(coarse.frame, 0);
  assert.equal(coarse.materialPackets.length, 1);
  assert.equal(coarse.materialPackets[0].id,
    "rock:ellipsoid-octahedron:v1:coarse");
  assert.deepEqual(coarse.detailUsage, { vertices: 0, faces: 0 });
  assert.equal(coarse.vectorBytes, 504);

  const refined = scene.updateProjectedDemand({
    camera: CAMERA,
    maxErrorPixels: 0,
  });
  assert.equal(refined.frame, 1);
  assert.equal(refined.effectiveDetailVertexBudget, 1);
  assert.deepEqual(refined.detailUsage, { vertices: 1, faces: 3 });
  assert.equal(refined.materialPackets.length, 2);
  assert.equal(refined.vectorBytes, 812);
  assert.ok(refined.vectorBytes <= refined.ramBudgetBytes);
  assert.deepEqual(refined.changes.created,
    ["face:+x:+y:+z"]);

  const steady = scene.updateProjectedDemand({
    camera: CAMERA,
    maxErrorPixels: 0,
  });
  assert.strictEqual(steady.materialPackets[0], refined.materialPackets[0]);
  assert.strictEqual(steady.materialPackets[1], refined.materialPackets[1]);
  assert.deepEqual(steady.changes, {
    retained: ["face:+x:+y:+z"],
    created: [],
    evicted: [],
  });

  const released = scene.updateProjectedDemand({
    camera: CAMERA,
    maxErrorPixels: 1_000,
  });
  assert.equal(released.materialPackets.length, 1);
  assert.equal(released.vectorBytes, 504);
  assert.deepEqual(released.changes.evicted,
    ["face:+x:+y:+z"]);
});

test("evicted stone detail regenerates identical correlated material", () => {
  const scene = createProceduralStoneAdaptiveSceneReference({
    identity: IDENTITY,
    radii: [1.4, 1.0, 0.8],
    detailVertexBudget: 2,
    ramBudgetBytes: 1_120,
    materialDetailLevel: 4,
    footprint: 0.02,
  });
  const near = () => scene.updateProjectedDemand({
    camera: CAMERA,
    maxErrorPixels: 0,
  });
  const first = near();
  const firstDetails = first.materialPackets.slice(1).map((packet) => ({
    id: packet.id,
    vertices: packet.vertices.slice(),
    roughness: packet.material_channels.roughness.slice(),
    displacement: packet.material_channels.displacement.slice(),
  }));
  scene.updateProjectedDemand({
    camera: CAMERA,
    maxErrorPixels: 1_000,
  });
  const regenerated = near();

  assert.equal(regenerated.vectorBytes, 1_120);
  assert.deepEqual(
    regenerated.materialPackets.slice(1).map((packet) => ({
      id: packet.id,
      vertices: packet.vertices,
      roughness: packet.material_channels.roughness,
      displacement: packet.material_channels.displacement,
    })),
    firstDetails,
  );
  assert.ok(regenerated.materialPackets.every((packet) => (
    packet.vertices.every(Number.isFinite)
  )));
});
