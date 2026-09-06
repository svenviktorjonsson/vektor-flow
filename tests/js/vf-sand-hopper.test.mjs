import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  createDrySandHopperReference,
  createDrySandEllipsoidRenderPacketReference,
  createDrySandHopperHardwarePacketsReference,
  createDrySandRenderPacketReference,
  resetDrySandHopperReference,
  runDrySandHopperTrialReference,
  stepDrySandHopperReference,
  syncDrySandRenderPacketReference,
  syncDrySandEllipsoidRenderPacketReference,
} from '../../web/vf-ui/vf-sand-hopper-reference.mjs';

const hash = (view) => createHash('sha256')
  .update(Buffer.from(view.buffer, view.byteOffset, view.byteLength)).digest('hex');

test('fixed-step hopper reset is byte deterministic and rendering shares particle state', () => {
  const world = createDrySandHopperReference({ seed: 0x5a17, grainCount: 384 });
  const initial = hash(world.state.positions);
  stepDrySandHopperReference(world, 90);
  assert.notEqual(hash(world.state.positions), initial);
  resetDrySandHopperReference(world);
  assert.equal(hash(world.state.positions), initial);
  assert.equal(world.render.positions, world.state.positions);
  assert.equal(world.render.orientations, world.state.orientations);
});

test('instanced grain packet is a derived view of the authoritative SoA state', () => {
  const world = createDrySandHopperReference({ seed: 0x51a9, grainCount: 256 });
  const packet = createDrySandRenderPacketReference(world);
  assert.equal(packet.instance_kind, 'sphere-list');
  assert.equal(packet.instance_count, world.count);
  assert.equal(packet.instances, world.render.instances);
  stepDrySandHopperReference(world, 12);
  syncDrySandRenderPacketReference(world, packet);
  for (let index = 0; index < world.count; index += 1) {
    assert.deepEqual([...packet.instances.subarray(index * 8, index * 8 + 3)], [
      ...world.state.positions.subarray(index * 3, index * 3 + 3),
    ]);
  }
});

test('granular discharge conserves mass and resolves persistent penetration', () => {
  const trial = runDrySandHopperTrialReference({
    seed: 0x5a17, grainCount: 512, outletDiameterInGrains: 4.5, duration: 4,
  });
  assert.ok(Math.abs(trial.massError) < 1e-9);
  assert.ok(trial.maxPersistentPenetration < trial.meanGrainDiameter * 0.06);
  assert.ok(trial.dischargedCount > 0);
  assert.ok(trial.activeCount + trial.dischargedCount === trial.initialGrainCount);
});

test('settled sand forms a stable bounded repose angle', () => {
  const trial = runDrySandHopperTrialReference({
    seed: 0x7b29, grainCount: 640, outletDiameterInGrains: 4.2, duration: 7,
  });
  assert.ok(trial.reposeAngleDegrees >= 24 && trial.reposeAngleDegrees <= 39);
  assert.ok(trial.settledSpeedRms < 0.08);
});

test('outlet sweep scales discharge and resolves a near-grain arch regime', () => {
  const diameters = [2.2, 3.2, 4.5];
  const trials = diameters.map((outletDiameterInGrains) => runDrySandHopperTrialReference({
    seed: 0x3129, grainCount: 512, outletDiameterInGrains, duration: 4,
  }));
  assert.ok(trials[0].clogged);
  assert.ok(trials[0].meanDischargeRate < trials[1].meanDischargeRate);
  assert.ok(trials[1].meanDischargeRate < trials[2].meanDischargeRate);
  assert.ok(trials[2].meanDischargeRate >= trials[1].meanDischargeRate * 1.35);
});

test('discharge is fill-height independent above the Janssen regime', () => {
  const low = runDrySandHopperTrialReference({
    seed: 0x9c41, grainCount: 384, fillHeightInGrains: 15,
    outletDiameterInGrains: 4.2, duration: 3,
  });
  const high = runDrySandHopperTrialReference({
    seed: 0x9c41, grainCount: 640, fillHeightInGrains: 24,
    outletDiameterInGrains: 4.2, duration: 3,
  });
  const relativeDifference = Math.abs(low.meanDischargeRate - high.meanDischargeRate)
    / Math.max(low.meanDischargeRate, high.meanDischargeRate);
  assert.ok(relativeDifference < 0.16);
});

test('grain state is bounded, mildly nonspherical, and fixed-step replay exact', () => {
  const first = runDrySandHopperTrialReference({
    seed: 0x174d, grainCount: 384, outletDiameterInGrains: 4, duration: 2,
  });
  const replay = runDrySandHopperTrialReference({
    seed: 0x174d, grainCount: 384, outletDiameterInGrains: 4, duration: 2,
  });
  assert.equal(first.stateHash, replay.stateHash);
  assert.ok(first.minimumAspectRatio >= 0.78 && first.minimumAspectRatio < 0.98);
  assert.ok(first.maximumAspectRatio <= 1.22 && first.maximumAspectRatio > 1.02);
  assert.ok(first.vectorBytes < 256 * 1024);
  assert.ok(first.fixedStep > 0 && first.solverIterations >= 2);
});

test('contact-driven grain rotation stays normalized and replay exact', () => {
  const realize = () => {
    const world = createDrySandHopperReference({ seed: 0x4a21, grainCount: 192, outletDiameterInGrains: 4.2 });
    stepDrySandHopperReference(world, 420);
    return world;
  };
  const first = realize();
  const replay = realize();
  assert.equal(hash(first.state.orientations), hash(replay.state.orientations));
  assert.equal(hash(first.state.angularVelocities), hash(replay.state.angularVelocities));
  assert.ok(first.state.angularVelocities.some(value => Math.abs(value) > 0.01));
  assert.notEqual(hash(first.state.orientations), hash(first.initial.orientations));
  for (let grain = 0; grain < first.count; grain += 1) {
    const q = first.state.orientations.subarray(grain * 4, grain * 4 + 4);
    assert.ok(Math.abs(Math.hypot(...q) - 1) < 2e-6);
  }
});

test('grain impact rebound scales with the configured restitution', () => {
  const collide = (restitution) => {
    const world = createDrySandHopperReference({ seed: 0x9912, grainCount: 2 });
    world.friction = 0; world.rollingResistance = 0; world.restitution = restitution;
    const d = world.diameter;
    world.state.positions.set([-0.49 * d, 0, 2.8, 0.49 * d, 0, 2.8]);
    world.state.velocities.set([0.30, 0, 0, -0.30, 0, 0]);
    stepDrySandHopperReference(world, 1);
    return world.state.velocities[3] - world.state.velocities[0];
  };
  const deadened = collide(0);
  const rebounding = collide(0.35);
  assert.ok(rebounding > deadened + 0.12);
  assert.ok(rebounding > 0);
});

test('rolling resistance dissipates contact spin without damping free flight', () => {
  const realize = (height) => {
    const world = createDrySandHopperReference({ seed: 0x9913, grainCount: 1 });
    world.state.positions.set([0, 0, height]);
    world.state.velocities.fill(0);
    world.state.angularVelocities.set([1, 0, 0]);
    stepDrySandHopperReference(world, 1);
    return Math.hypot(...world.state.angularVelocities);
  };
  const free = realize(2.8);
  const grounded = realize(0.026);
  assert.ok(Math.abs(free - 1) < 1e-6);
  assert.ok(grounded < free * 0.95);
});

test('grain friction reduces slip without exceeding its Coulomb impact bound', () => {
  const world = createDrySandHopperReference({ seed: 0x9914, grainCount: 2 });
  world.friction = 0.20; world.rollingResistance = 0; world.restitution = 0.10;
  const d = world.diameter;
  world.state.positions.set([-0.49 * d, 0, 2.8, 0.49 * d, 0, 2.8]);
  world.state.velocities.set([0.30, 0.50, 0, -0.30, -0.50, 0]);
  stepDrySandHopperReference(world, 1);
  const normalImpulse = Math.abs(world.state.velocities[0] - 0.30);
  const tangentImpulse = Math.abs(world.state.velocities[1] - 0.50);
  const remainingSlip = world.state.velocities[1] - world.state.velocities[4];
  assert.ok(remainingSlip >= -1e-6 && remainingSlip < 1);
  assert.ok(tangentImpulse <= world.friction * normalImpulse + 1e-6);
});

test('oriented ellipsoid mesh is a dynamic view of the authoritative grain SoA', () => {
  const world = createDrySandHopperReference({ seed: 0x4a22, grainCount: 96, outletDiameterInGrains: 4.2 });
  const packet = createDrySandEllipsoidRenderPacketReference(world, { latitudeSegments: 5, longitudeSegments: 8 });
  const before = hash(packet.vertices);
  stepDrySandHopperReference(world, 180);
  syncDrySandEllipsoidRenderPacketReference(world, packet);
  assert.notEqual(hash(packet.vertices), before);
  assert.equal(packet.sourcePositions, world.state.positions);
  assert.equal(packet.sourceOrientations, world.state.orientations);
  assert.equal(packet.static_vertices, false);
  assert.ok(packet.vertices.every(Number.isFinite));
  assert.ok(packet.indices.every(index => index < packet.vertices.length / 10));
  assert.equal(packet.indices.length / 3, world.count * 5 * 8 * 2);
  assert.ok(packet.vectorBytes < 2 * 1024 * 1024);
});

test('visible circular plate hole is the exact physics outlet boundary', () => {
  const world = createDrySandHopperReference({ grainCount: 96, outletDiameterInGrains: 4.2 });
  const hardware = createDrySandHopperHardwarePacketsReference(world);
  assert.deepEqual(hardware.map(packet => packet.id), ['sand:circular-hopper', 'sand:outlet-plate']);
  const plate = hardware[1];
  const radii = [];
  for (let vertex = 0; vertex < plate.vertices.length; vertex += 10) {
    const x = plate.vertices[vertex]; const y = plate.vertices[vertex + 1];
    assert.ok(Math.abs(plate.vertices[vertex + 2] - world.hopperBottom) < 1e-7);
    radii.push(Math.hypot(x, y));
  }
  assert.ok(Math.abs(Math.min(...radii) - world.outletRadius) < 1e-7);
  assert.ok(Math.max(...radii) > world.outletRadius * 2.5);
  assert.ok(plate.indices.every(index => index < plate.vertices.length / 10));
  for (let offset = 0; offset < plate.indices.length; offset += 3) {
    const triangleRadii = Array.from(plate.indices.slice(offset, offset + 3), index => radii[index]);
    assert.ok(triangleRadii.some(radius => Math.abs(radius - world.outletRadius) < 1e-7));
  }
});

test('WebGPU fixture renders the stepped SoA state without a canvas fallback', () => {
  const scene = readFileSync(new URL('../fixtures/dry-sand-hopper-scene.mjs', import.meta.url), 'utf8');
  const html = readFileSync(new URL('../fixtures/dry-sand-hopper.html', import.meta.url), 'utf8');
  assert.match(html, /vf-runtime-shell\.js/);
  assert.match(scene, /unified_renderer:\s*true/);
  assert.match(scene, /stepDrySandHopperReference\(world, 1\)/);
  assert.match(scene, /syncDrySandEllipsoidRenderPacketReference\(world, grains\)/);
  assert.match(scene, /createDrySandHopperHardwarePacketsReference/);
  assert.doesNotMatch(scene + html, /CanvasRenderingContext2D|drawImage|putImageData/);
});
