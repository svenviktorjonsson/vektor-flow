import assert from "node:assert/strict";
import test from "node:test";

import {
  createProceduralStonePopulationSceneReference,
} from "../../web/vf-ui/vf-procedural-stone-population-scene.mjs";

const IDENTITY = Object.freeze({
  generator: "vkf.conditioned",
  version: 1,
  seed: Object.freeze([0x510e527f, 0x9b05688c]),
  domain: "material",
  hierarchy: Object.freeze(["world:highland", "stone-field:north"]),
  lod: 0,
  channel: "population",
});

const CAMERA = Object.freeze({
  eye: Object.freeze([15, -4, 5]),
  target: Object.freeze([10, -4, 0]),
  up: Object.freeze([0, 0, 1]),
  verticalFovRadians: Math.PI / 3,
  viewportHeight: 1080,
});

test("multi-stone scene keeps vector identity under aggregate budgets", () => {
  const scene = createProceduralStonePopulationSceneReference({
    identity: IDENTITY,
    stoneBudget: 13,
    detailVertexBudget: 2,
    ramBudgetBytes: 7_649,
    materialDetailLevel: 4,
    footprint: 0.02,
  });
  const coarse = scene.updatePatches({ patches: [[2, -1]] });

  assert.equal(coarse.kind, "procedural-stone-population-scene:v1");
  assert.equal(coarse.population.stoneCount, 13);
  assert.equal(coarse.vectorBytes, 7_033);
  assert.equal(coarse.materialPackets.length, 13);
  assert.ok(coarse.materialPackets.every((packets) => packets.length === 1));
  assert.deepEqual(Array.from(coarse.refinementVertices),
    Array(13).fill(0));
  assert.deepEqual(coarse.stoneIds, coarse.population.stoneIds);
  assert.equal(coarse.population.patches[0].dominantFamily, 3);
  assert.equal(
    Array.from(coarse.familyIndices).filter((family) => family === 3).length,
    10,
  );
  const familyThreeRadii = Array.from(coarse.familyIndices)
    .flatMap((family, stone) => (
      family === 3
        ? [coarse.radii[stone * 3]]
        : []
    ));
  assert.ok(new Set(familyThreeRadii).size > 1);

  const refined = scene.updateProjectedDemand({
    camera: CAMERA,
    maxErrorPixels: 0,
  });
  assert.equal(refined.vectorBytes, 7_649);
  assert.ok(refined.vectorBytes <= refined.ramBudgetBytes);
  assert.equal(
    Array.from(refined.refinementVertices).reduce((sum, value) => sum + value),
    2,
  );
  assert.equal(
    refined.materialPackets.filter((packets) => packets.length === 2).length,
    2,
  );
  assert.deepEqual(refined.stoneIds, coarse.stoneIds);
  assert.deepEqual(refined.positions, coarse.positions);
  assert.deepEqual(refined.radii, coarse.radii);

  const steady = scene.updateProjectedDemand({
    camera: CAMERA,
    maxErrorPixels: 0,
  });
  steady.materialPackets.forEach((packets, stone) => {
    assert.strictEqual(packets[0], refined.materialPackets[stone][0]);
    if (packets.length === 2) {
      assert.strictEqual(packets[1], refined.materialPackets[stone][1]);
    }
  });

  const firstSelected = refined.stoneIds.filter((stoneId, stone) => (
    refined.refinementVertices[stone] === 1
  ));
  const firstDetails = new Map(refined.materialPackets.flatMap(
    (packets, stone) => packets.length === 2
      ? [[refined.stoneIds[stone], {
        id: packets[1].id,
        vertices: packets[1].vertices.slice(),
        roughness: packets[1].material_channels.roughness.slice(),
      }]]
      : [],
  ));
  const moved = scene.updateProjectedDemand({
    camera: { ...CAMERA, eye: [8, -4, 5] },
    maxErrorPixels: 0,
  });
  const movedSelected = moved.stoneIds.filter((stoneId, stone) => (
    moved.refinementVertices[stone] === 1
  ));
  assert.notDeepEqual(movedSelected, firstSelected);
  assert.deepEqual(moved.stoneIds, refined.stoneIds);
  assert.ok(moved.vectorBytes <= moved.ramBudgetBytes);
  const returned = scene.updateProjectedDemand({
    camera: CAMERA,
    maxErrorPixels: 0,
  });
  assert.deepEqual(returned.stoneIds.filter((stoneId, stone) => (
    returned.refinementVertices[stone] === 1
  )), firstSelected);
  firstDetails.forEach((detail, stoneId) => {
    const stone = returned.stoneIds.indexOf(stoneId);
    const packet = returned.materialPackets[stone][1];
    assert.deepEqual({
      id: packet.id,
      vertices: packet.vertices,
      roughness: packet.material_channels.roughness,
    }, detail);
  });

  const firstCoarsePackets = coarse.materialPackets.map(([packet]) => ({
    id: packet.id,
    vertices: packet.vertices.slice(),
    roughness: packet.material_channels.roughness.slice(),
  }));
  const removed = scene.updatePatches({ patches: [] });
  assert.equal(removed.vectorBytes, 0);
  assert.deepEqual(removed.changes.evicted, coarse.stoneIds);
  const regenerated = scene.updatePatches({ patches: [[2, -1]] });
  assert.deepEqual(regenerated.population, coarse.population);
  assert.deepEqual(
    regenerated.materialPackets.map(([packet]) => ({
      id: packet.id,
      vertices: packet.vertices,
      roughness: packet.material_channels.roughness,
    })),
    firstCoarsePackets,
  );
  assert.equal(regenerated.vectorBytes, 7_033);
});

test("population RAM capacity reduces coarse stone demand first", () => {
  const scene = createProceduralStonePopulationSceneReference({
    identity: IDENTITY,
    stoneBudget: 13,
    detailVertexBudget: 13,
    ramBudgetBytes: 1_082,
    materialDetailLevel: 4,
    footprint: 0.02,
  });
  const bounded = scene.updatePatches({ patches: [[2, -1]] });

  assert.equal(bounded.population.stoneCount, 2);
  assert.equal(bounded.vectorBytes, 1_082);
  assert.equal(bounded.effectiveDetailVertexBudget, 0);
  assert.ok(bounded.materialPackets.every((packets) => packets.length === 1));
});
