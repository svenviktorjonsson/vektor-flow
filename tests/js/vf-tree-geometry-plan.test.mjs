import test from 'node:test';
import assert from 'node:assert/strict';

import { createForestPopulationReference, realizeForestPatchesReference } from '../../web/vf-ui/vf-forest-population.mjs';
import { createTreeGeometryPlannerReference, planTreeGeometryReference } from '../../web/vf-ui/vf-tree-geometry-plan.mjs';
import { treeSpeciesProfileReference } from '../../web/vf-ui/vf-tree-species-profile.mjs';

const IDENTITY = Object.freeze({ generator: 'vkf.conditioned', version: 1,
  seed: Object.freeze([0x1f83d9ab, 0x5be0cd19]), domain: 'material',
  hierarchy: Object.freeze(['world:boreal', 'forest:north-slope']), lod: 0, channel: 'population' });

function forestWorkingSet(identity = IDENTITY) {
  return realizeForestPatchesReference(createForestPopulationReference(identity), {
    patches: [[-2, 3]], treeBudget: 32,
  });
}

function endpoint(p) {
  const t = p.transform;
  const start = p.kind === 0
    ? t.slice(0, 3).map((v, axis) => v - t[axis + 3] * t[6] * 0.5) : t.slice(0, 3);
  return start.map((v, axis) => v + t[axis + 3] * t[6]);
}

function distance(a, b) { return Math.hypot(...a.map((v, axis) => v - b[axis])); }

function envelopeMetric(e, p) {
  const dx = p[0] - e.center[0]; const dy = p[1] - e.center[1];
  const c = Math.cos(e.orientation); const s = Math.sin(e.orientation);
  const local = [dx * c + dy * s, -dx * s + dy * c, p[2] - e.center[2]];
  return local.reduce((sum, v, axis) => sum + (v / e.axes[axis]) ** 2, 0);
}

function fullPlan(identity = IDENTITY) {
  const forest = forestWorkingSet(identity);
  return planTreeGeometryReference(createTreeGeometryPlannerReference(identity), forest, {
    treeIndices: [0], detailLevels: [2], primitiveBudget: 256,
  });
}

function byParent(tree, p) { return tree.primitives.find((candidate) => candidate.id === p.parentId); }

test('internal species profiles expose bounded future-configurable statistics', () => {
  const profiles = Array.from({ length: 5 }, (_, i) => treeSpeciesProfileReference(i));
  assert.ok(profiles.every(Object.isFrozen));
  assert.equal(new Set(profiles.map(JSON.stringify)).size, 5);
  for (const profile of profiles) {
    assert.equal(profile.kind, 'tree-species-profile:v1');
    assert.ok(profile.pathLength.scaleBounds[0] < profile.pathLength.scaleMean);
    assert.ok(profile.pathLength.scaleMean < profile.pathLength.scaleBounds[1]);
    assert.ok(profile.split.mainAngleBounds[0] > 0);
    assert.ok(profile.split.areaLossBounds[1] < 1);
    assert.equal(profile.crownEnvelope.axisScaleMean.length, 3);
    assert.equal(profile.bark.textureVariantWeights.length, 3);
  }
  assert.throws(() => treeSpeciesProfileReference(5), /must be in/);
});

test('binary topology ends parent at split, orders deviation, and loses area', () => {
  const plan = fullPlan(); const tree = plan.trees[0];
  const wood = tree.primitives.filter((p) => [0, 2, 4].includes(p.kind));
  const branches = wood.filter((p) => p.kind === 2);
  const twigs = wood.filter((p) => p.kind === 4);
  const foliage = tree.primitives.filter((p) => p.kind === 3);
  assert.equal(branches.length, 14); assert.equal(twigs.length, 48);
  assert.ok(foliage.length >= 96 && foliage.length <= 192); assert.ok(plan.primitiveCount <= 256);
  const children = new Map();
  for (const p of wood) if (p.parentId !== null) {
    if (!children.has(p.parentId)) children.set(p.parentId, []);
    children.get(p.parentId).push(p);
  }
  for (const parent of wood) {
    const offspring = children.get(parent.id) ?? [];
    if (parent.kind === 4 && parent.generation === 5) { assert.equal(offspring.length, 0); continue; }
    assert.equal(offspring.length, 2);
    assert.ok(offspring.every((child) => distance(child.transform.slice(0, 3), endpoint(parent)) < 1e-5));
    assert.ok(offspring.every((child) => child.splitAngle > 0.001));
    const ordered = [...offspring].sort((a, b) => b.transform[7] - a.transform[7]);
    assert.ok(ordered[0].splitAngle <= ordered[1].splitAngle + 1e-10);
    assert.ok(offspring.reduce((sum, child) => sum + child.transform[7] ** 2, 0)
      < parent.transform[7] ** 2);
  }
});

test('arc-length budgets consume and terminate inside bounded ellipsoid', () => {
  const tree = fullPlan().trees[0];
  const wood = tree.primitives.filter((p) => [0, 2, 4].includes(p.kind));
  for (const p of wood) {
    assert.ok(p.pathRemainingAfter < p.pathRemainingBefore);
    assert.ok(p.pathRemainingAfter >= 0); assert.ok(p.transform[6] <= p.pathRemainingBefore + 1e-9);
    assert.ok(envelopeMetric(tree.envelope, endpoint(p)) <= 1.00001);
    if (p.parentId !== null) assert.ok(p.pathRemainingBefore <= byParent(tree, p).pathRemainingAfter);
  }
  assert.ok(wood.filter((p) => p.kind === 4)
    .every((p) => p.pathRemainingAfter / tree.targetPathLength < 0.04 || p.envelopeLimited));
  const rootRadius = wood.find((p) => p.kind === 0).transform[7];
  assert.ok(wood.filter((p) => p.pathRemainingAfter / tree.targetPathLength < 0.01)
    .every((p) => p.transform[7] < rootRadius * 0.2));
  assert.ok(wood.flatMap((p) => p.transform).every(Number.isFinite));
});

test('leaves use varied nonterminal twig positions; replay exact and seed varies', () => {
  const first = fullPlan(); const replay = fullPlan();
  const alternateIdentity = Object.freeze({ ...IDENTITY,
    seed: Object.freeze([IDENTITY.seed[0], (IDENTITY.seed[1] ^ 0x9e3779b9) >>> 0]) });
  const alternate = fullPlan(alternateIdentity);
  assert.deepEqual(replay, first); assert.notDeepEqual(Array.from(alternate.transforms), Array.from(first.transforms));
  const tree = first.trees[0]; const byId = new Map(tree.primitives.map((p) => [p.id, p]));
  const positions = [];
  for (const leaf of tree.primitives.filter((p) => p.kind === 3)) {
    const twig = byId.get(leaf.parentId); assert.equal(twig.kind, 4);
    const offset = leaf.transform.slice(0, 3).map((v, axis) => v - twig.transform[axis]);
    const along = offset.reduce((sum, v, axis) => sum + v * twig.transform[axis + 3], 0) / twig.transform[6];
    positions.push(along);
    assert.ok(along >= tree.profile.twig.attachmentBounds[0] - 1e-5);
    assert.ok(along <= tree.profile.twig.attachmentBounds[1] + 1e-5);
  }
  assert.ok(positions.some((v) => v < 0.7));
  assert.ok(new Set(positions.map((v) => v.toFixed(4))).size > 8);
});

test('whole-tree envelopes and path-local budgets vary under hard RAM bounds', () => {
  const forest = forestWorkingSet(); const indices = Array.from({ length: forest.treeCount }, (_, i) => i);
  const plan = planTreeGeometryReference(createTreeGeometryPlannerReference(IDENTITY), forest, {
    treeIndices: indices, detailLevels: indices.map(() => 2), primitiveBudget: 4096,
  });
  assert.ok(plan.primitiveCount <= forest.treeCount * 256); assert.equal(plan.vectorBytes, plan.primitiveCount * 42);
  assert.ok(new Set(plan.trees.map((t) => t.targetPathLength.toFixed(5))).size > 4);
  assert.ok(new Set(plan.trees.map((t) => t.envelope.axes.join(','))).size > 4);
  const ratios = plan.trees[0].primitives.filter((p) => p.kind === 2)
    .map((p) => p.pathRemainingBefore / byParent(plan.trees[0], p).pathRemainingAfter);
  assert.ok(new Set(ratios.map((v) => v.toFixed(4))).size > 4);
});

test('bounded planning serves coarse geometry first and keeps typed-vector ABI', () => {
  const forest = forestWorkingSet(); const planner = createTreeGeometryPlannerReference(IDENTITY);
  const plan = planTreeGeometryReference(planner, forest, {
    treeIndices: [1, 0, 0], detailLevels: [2, 1, 2], primitiveBudget: 5,
  });
  assert.deepEqual(Array.from(plan.kinds), [0, 1, 0, 1, 2]);
  assert.deepEqual(Array.from(plan.owners), [0, 0, 1, 1, 0]);
  assert.deepEqual(Array.from(plan.parents), [-1, -1, -1, -1, 0]);
  assert.equal(plan.vectorBytes, 210); assert.ok(plan.transforms instanceof Float32Array);
});
