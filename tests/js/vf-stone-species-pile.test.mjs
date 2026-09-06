import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  createStoneSpeciesPileReference,
} from '../../web/vf-ui/vf-stone-species-pile.mjs';
import {
  realizeGraniteGranularProbeReference,
} from '../../web/vf-ui/vf-granite-microrelief-reference.mjs';

const hashView = (view) => createHash('sha256')
  .update(Buffer.from(view.buffer, view.byteOffset, view.byteLength)).digest('hex');

function boundaryEdges(packet) {
  const edges = new Map();
  for (let offset = 0; offset < packet.indices.length; offset += 3) {
    const ids = packet.indices.slice(offset, offset + 3);
    for (let edge = 0; edge < 3; edge += 1) {
      const ends = [ids[edge], ids[(edge + 1) % 3]].sort((a, b) => a - b);
      const key = `${ends[0]}:${ends[1]}`;
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  }
  return [...edges.values()].filter((count) => count !== 2).length;
}

test('pile realizes exactly four unique closed individuals from each of five species', () => {
  const pile = createStoneSpeciesPileReference();
  assert.equal(pile.individuals.length, 20);
  assert.deepEqual(
    pile.profiles.map((_, speciesIndex) => (
      pile.individuals.filter((item) => item.speciesIndex === speciesIndex).length
    )),
    [4, 4, 4, 4, 4],
  );
  assert.equal(new Set(pile.individuals.map((item) => item.seed.join(':'))).size, 20);
  assert.equal(new Set(pile.meshes.map((packet) => hashView(packet.vertices))).size, 20);
  assert.ok(pile.individuals.every((item) => item.undersideHeightSpan > 0.035));
  assert.ok(pile.meshes.every((packet) => boundaryEdges(packet) === 0));
  assert.ok(pile.meshes.every((packet) => packet.indices.length / 3 === 5184));
});

test('pile placement is deterministic, grounded, supported, and bounded', () => {
  const first = createStoneSpeciesPileReference();
  const replay = createStoneSpeciesPileReference();
  const signature = (pile) => pile.individuals.map((item, index) => ({
    species: item.speciesId, seed: item.seed, center: item.center,
    scale: item.scale, yaw: item.yaw,
    vertices: hashView(pile.meshes[index].vertices),
    indices: hashView(pile.meshes[index].indices),
  }));
  assert.deepEqual(signature(replay), signature(first));
  const grounded = first.individuals.filter((item) => Math.abs(item.center[2]) <= 1e-9);
  assert.ok(grounded.length >= 5);
  for (const item of first.individuals.filter((candidate) => candidate.layer > 0)) {
    const supports = first.individuals.filter((candidate) => (
      candidate.layer < item.layer
      && Math.hypot(item.center[0] - candidate.center[0], item.center[1] - candidate.center[1])
        <= item.supportRadius + candidate.supportRadius
    ));
    assert.ok(supports.length >= 2);
  }
  assert.ok(first.individuals.reduce((sum, item) => sum + item.vectorBytes, 0) < 5 * 1024 * 1024);
});

test('gravity-settled pile has contact support without persistent proxy penetration', () => {
  const pile = createStoneSpeciesPileReference();
  const elevated = pile.individuals.filter((item) => item.center[2] > 1e-7);
  assert.ok(elevated.length >= 8);
  assert.ok(elevated.every((item) => item.contacts.length >= 1));
  assert.ok(elevated.every((item) => item.contacts.every((contact) => (
    contact.supportIndex < item.index && Math.abs(contact.normalizedSeparation - 1) < 2e-6
  ))));
  assert.ok(pile.settlement.maximumNormalizedPenetration <= 2e-6);
  assert.equal(pile.settlement.floatingCount, 0);
});

test('species material descriptors stay coherent while sharing zero-triangle microrelief', () => {
  const pile = createStoneSpeciesPileReference();
  pile.profiles.forEach((profile, speciesIndex) => {
    assert.ok(profile.albedo[0] >= 0.07 && profile.albedo[1] <= 0.84);
    assert.ok(profile.roughness[0] >= 0.66 && profile.roughness[1] <= 0.94);
    const members = pile.meshes.filter((packet) => (
      packet.rock_material_gpu.speciesIndex === speciesIndex
    ));
    assert.equal(members.length, 4);
    assert.ok(members.every((packet) => packet.rock_material_gpu.variant === 'weathered-granite-granular'));
    assert.ok(members.every((packet) => packet.vertices.length / 10 === 2594));
  });
  assert.equal(new Set(pile.profiles.map((profile) => profile.id)).size, 5);
});

test('one individual per species retains directional fine-relief reversal', () => {
  const pile = createStoneSpeciesPileReference();
  for (let speciesIndex = 0; speciesIndex < 5; speciesIndex += 1) {
    const identity = pile.individuals.find((item) => item.speciesIndex === speciesIndex).identity;
    const probe = realizeGraniteGranularProbeReference(identity, {
      resolution: 16,
      footprint: 0.0015,
    });
    assert.ok(probe.r8MicroShadowReversalFraction > 0.20);
    assert.equal(probe.r8EmptyCoverageTileFraction, 0);
  }
});
