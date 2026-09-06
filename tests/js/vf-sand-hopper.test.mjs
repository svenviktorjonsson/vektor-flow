import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  createDrySandHopperReference,
  createDrySandRenderPacketReference,
  resetDrySandHopperReference,
  runDrySandHopperTrialReference,
  stepDrySandHopperReference,
  syncDrySandRenderPacketReference,
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

test('WebGPU fixture renders the stepped SoA state without a canvas fallback', () => {
  const scene = readFileSync(new URL('../fixtures/dry-sand-hopper-scene.mjs', import.meta.url), 'utf8');
  const html = readFileSync(new URL('../fixtures/dry-sand-hopper.html', import.meta.url), 'utf8');
  assert.match(html, /vf-runtime-shell\.js/);
  assert.match(scene, /unified_renderer:\s*true/);
  assert.match(scene, /stepDrySandHopperReference\(world, 1\)/);
  assert.match(scene, /syncDrySandRenderPacketReference\(world, grains\)/);
  assert.match(scene, /segments = 64/);
  assert.doesNotMatch(scene + html, /CanvasRenderingContext2D|drawImage|putImageData/);
});
