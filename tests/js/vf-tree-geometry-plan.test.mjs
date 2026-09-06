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
    treeIndices: [0], detailLevels: [2], primitiveBudget: 2400,
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
    assert.equal(profile.split.allometricExponent, 2);
    assert.equal(profile.crownEnvelope.axisScaleMean.length, 3);
    assert.ok(profile.colonization.attractionPointCount >= 64);
    assert.ok(profile.colonization.directionBlend > 0 && profile.colonization.directionBlend < 0.6);
    assert.ok(profile.colonization.lightWeight + profile.colonization.spaceWeight
      + profile.colonization.alignmentWeight === 1);
    assert.ok(Math.abs(profile.twig.phyllotaxisDivergence - Math.PI * (3 - Math.sqrt(5))) < 1e-12);
    assert.deepEqual(profile.bark.featureGrammar, ['ridge', 'furrow', 'fissure', 'lenticel']);
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
  assert.equal(branches.length, 30); assert.ok(twigs.length >= 160 && twigs.length <= 300);
  assert.ok(foliage.length >= twigs.length * 5 && foliage.length <= twigs.length * 9);
  assert.ok(plan.primitiveCount <= 2400);
  const children = new Map();
  for (const p of wood) if (p.parentId !== null) {
    if (!children.has(p.parentId)) children.set(p.parentId, []);
    children.get(p.parentId).push(p);
  }
  for (const parent of wood) {
    const offspring = (children.get(parent.id) ?? []).filter((child) => child.splitRole);
    if (parent.kind === 4 && (parent.generation === 6 || parent.twigClass === 'lateral-shoot')) {
      assert.equal(offspring.length, 0); continue;
    }
    assert.equal(offspring.length, 2);
    assert.ok(offspring.every((child) => distance(child.transform.slice(0, 3), endpoint(parent)) < 1e-5));
    assert.ok(offspring.every((child) => child.splitAngle > 0.001));
    const ordered = [...offspring].sort((a, b) => b.transform[7] - a.transform[7]);
    assert.ok(ordered[0].splitAngle <= ordered[1].splitAngle + 1e-10);
    assert.ok(offspring.reduce((sum, child) => sum + child.transform[7] ** 2, 0)
      < parent.transform[7] ** 2);
  }
  const shootsByParent = new Map();
  for (const shoot of twigs.filter((p) => p.twigClass === 'lateral-shoot')) {
    const parent = tree.primitives.find((p) => p.id === shoot.parentId);
    assert.ok(parent.kind === 0 || parent.kind === 2);
    assert.ok(shoot.transform[7] < parent.transform[7] * 0.1);
    assert.ok(shoot.normalizedParentPosition >= (parent.kind === 0 ? 0.55 : 0.12));
    assert.ok(shoot.normalizedParentPosition <= 0.9);
    if (!shootsByParent.has(parent.id)) shootsByParent.set(parent.id, []);
    shootsByParent.get(parent.id).push(shoot);
  }
  for (const [parentId, shoots] of shootsByParent) {
    const parent = tree.primitives.find((p) => p.id === parentId);
    assert.ok(shoots.reduce((sum, shoot) => sum + shoot.transform[7] ** 2, 0)
      < parent.transform[7] ** 2 * 0.04);
  }
});

test('arc-length budgets consume and terminate inside bounded ellipsoid', () => {
  const tree = fullPlan().trees[0];
  const wood = tree.primitives.filter((p) => [0, 2, 4].includes(p.kind));
  for (const p of wood) {
    assert.ok(p.pathRemainingAfter < p.pathRemainingBefore);
    assert.ok(p.pathRemainingAfter >= 0); assert.ok(p.curve.arcLength <= p.pathRemainingBefore + 1e-9);
    assert.ok(envelopeMetric(tree.envelope, endpoint(p)) <= 1.00001);
    assert.ok(p.curve.points.every((point) => envelopeMetric(tree.envelope, point) <= 1.00001));
    if (p.parentId !== null) assert.ok(p.pathRemainingBefore <= byParent(tree, p).pathRemainingAfter);
  }
  const parentIds = new Set(wood.map((p) => p.parentId).filter(Boolean));
  assert.ok(wood.filter((p) => p.kind === 4 && !parentIds.has(p.id))
    .every((p) => p.pathRemainingAfter / tree.targetPathLength < 0.04 || p.envelopeLimited));
  const rootRadius = wood.find((p) => p.kind === 0).transform[7];
  assert.ok(wood.filter((p) => p.pathRemainingAfter / tree.targetPathLength < 0.01)
    .every((p) => p.transform[7] < rootRadius * 0.2));
  assert.ok(wood.flatMap((p) => p.transform).every(Number.isFinite));
});

test('persistent curve steps stay smooth while turn variance rises as radius falls', () => {
  const tree = fullPlan().trees[0];
  const rootRadius = tree.primitives.find((p) => p.kind === 0).transform[7];
  const bands = [[], [], []];
  for (const primitive of tree.primitives.filter((p) => p.curve)) {
    assert.ok(primitive.curve.points.length > 2);
    assert.equal(primitive.curve.tangents.length, primitive.curve.points.length - 1);
    assert.equal(primitive.curve.turns.length, primitive.curve.tangents.length - 1);
    assert.ok(primitive.curve.turns.some((turn) => turn > 1e-7));
    assert.ok(primitive.curve.turns.every((turn) => turn <= primitive.curve.maximumTurn + 1e-9));
    assert.ok(primitive.curve.correlation >= 0.75);
    const radiusRatio = primitive.transform[7] / rootRadius;
    const band = radiusRatio > 0.7 ? 0 : radiusRatio > 0.18 ? 1 : 2;
    bands[band].push(...primitive.curve.turns);
  }
  const rms = (values) => Math.sqrt(
    values.reduce((sum, value) => sum + value ** 2, 0) / values.length,
  );
  const curvature = bands.map(rms);
  assert.ok(curvature[0] < curvature[1]);
  assert.ok(curvature[1] < curvature[2]);
});

test('leaves use varied nonterminal twig positions; replay exact and seed varies', () => {
  const first = fullPlan(); const replay = fullPlan();
  const alternateIdentity = Object.freeze({ ...IDENTITY,
    seed: Object.freeze([IDENTITY.seed[0], (IDENTITY.seed[1] ^ 0x9e3779b9) >>> 0]) });
  const alternate = fullPlan(alternateIdentity);
  assert.deepEqual(replay, first); assert.notDeepEqual(Array.from(alternate.transforms), Array.from(first.transforms));
  const tree = first.trees[0]; const byId = new Map(tree.primitives.map((p) => [p.id, p]));
  const positions = [];
  let shootLeaves = 0; let shootTwigs = 0; let terminalLeaves = 0; let terminalTwigs = 0;
  for (const twig of tree.primitives.filter((p) => p.kind === 4)) {
    if (twig.twigClass === 'lateral-shoot') shootTwigs += 1; else terminalTwigs += 1;
  }
  for (const leaf of tree.primitives.filter((p) => p.kind === 3)) {
    const twig = byId.get(leaf.parentId); assert.equal(twig.kind, 4);
    if (twig.twigClass === 'lateral-shoot') shootLeaves += 1; else terminalLeaves += 1;
    const along = leaf.normalizedTwigPosition;
    positions.push(along);
    assert.ok(along >= tree.profile.twig.attachmentBounds[0] - 1e-5);
    assert.ok(along <= tree.profile.twig.attachmentBounds[1] + 1e-5);
  }
  assert.ok(shootLeaves / shootTwigs > terminalLeaves / terminalTwigs * 1.8);
  assert.ok(positions.some((v) => v > 0.75));
  assert.ok(positions.filter((v) => v < 0.72).length / positions.length > 0.8);
  assert.ok(new Set(positions.map((v) => v.toFixed(4))).size > 8);
  const envelope = tree.envelope;
  const heightBins = new Set(); const radialBins = new Set(); const angularBins = new Set();
  for (const leaf of tree.primitives.filter((p) => p.kind === 3)) {
    const [x, y, z] = leaf.transform;
    const height = (z - (envelope.center[2] - envelope.axes[2])) / (2 * envelope.axes[2]);
    const dx = x - envelope.center[0]; const dy = y - envelope.center[1];
    const radius = Math.hypot(dx / envelope.axes[0], dy / envelope.axes[1]);
    const angle = (Math.atan2(dy, dx) + Math.PI * 2) % (Math.PI * 2);
    heightBins.add(Math.max(0, Math.min(5, Math.floor(height * 6))));
    radialBins.add(Math.max(0, Math.min(4, Math.floor(radius * 5))));
    angularBins.add(Math.floor(angle / (Math.PI * 2) * 8));
  }
  assert.ok(heightBins.size >= 3); assert.ok(radialBins.size >= 3); assert.ok(angularBins.size >= 4);
});

test('lateral twig frequency is nonzero on trunks and rises toward thin parents', () => {
  let thickParents = 0; let thinParents = 0; let thickShoots = 0; let thinShoots = 0;
  let trunkShoots = 0; let pinnedTreeThreeTrunkShoots = 0;
  for (let seedIndex = 0; seedIndex < 4; seedIndex += 1) {
    const identity = Object.freeze({ ...IDENTITY,
      seed: Object.freeze([IDENTITY.seed[0], (IDENTITY.seed[1] + seedIndex * 0x9e3779b9) >>> 0]) });
    const forest = forestWorkingSet(identity);
    for (let treeIndex = 0; treeIndex < Math.min(8, forest.treeCount); treeIndex += 1) {
      const plan = planTreeGeometryReference(createTreeGeometryPlannerReference(identity), forest, {
        treeIndices: [treeIndex], detailLevels: [2], primitiveBudget: 1800,
      });
      const tree = plan.trees[0]; const byId = new Map(tree.primitives.map((p) => [p.id, p]));
      const rootRadius = tree.primitives.find((p) => p.kind === 0).transform[7];
      for (const parent of tree.primitives.filter((p) => p.kind === 0 || p.kind === 2)) {
        if (parent.transform[7] / rootRadius > 0.35) thickParents += 1; else thinParents += 1;
      }
      for (const shoot of tree.primitives.filter((p) => p.twigClass === 'lateral-shoot')) {
        const parent = byId.get(shoot.parentId);
        if (parent.kind === 0) {
          trunkShoots += 1;
          if (seedIndex === 0 && treeIndex === 3) pinnedTreeThreeTrunkShoots += 1;
        }
        if (parent.transform[7] / rootRadius > 0.35) thickShoots += 1; else thinShoots += 1;
      }
    }
  }
  const slots = treeSpeciesProfileReference(0).twig.shootSlots;
  const thickFrequency = thickShoots / (thickParents * slots);
  const thinFrequency = thinShoots / (thinParents * slots);
  assert.ok(trunkShoots > 0); assert.ok(thickFrequency > 0); assert.ok(thickFrequency < thinFrequency);
  assert.ok(pinnedTreeThreeTrunkShoots > 0);
});

test('whole-tree envelopes and path-local budgets vary under hard RAM bounds', () => {
  const forest = forestWorkingSet(); const indices = Array.from({ length: forest.treeCount }, (_, i) => i);
  const plan = planTreeGeometryReference(createTreeGeometryPlannerReference(IDENTITY), forest, {
    treeIndices: indices, detailLevels: indices.map(() => 2), primitiveBudget: 4096,
  });
  assert.ok(plan.primitiveCount <= 4096); assert.equal(plan.vectorBytes, plan.primitiveCount * 42);
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
