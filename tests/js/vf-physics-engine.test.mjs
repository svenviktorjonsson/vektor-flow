import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAXWELL_BOUNDARIES,
  createGlobalFieldRegistry,
  createPhysicsScope,
  maxwellCflLimit,
  solveElectrostaticPotential,
  sampleGlobalField,
  stepDoublePendulum,
  stepHeatField,
  stepInertialBodies,
  stepMaxwellField,
  stepRigidPolygonWorld2D,
  stepThermalNetwork
} from '../../web/vf-ui/vf-physics-engine.mjs';

test('double pendulum advances two horizontal one-metre links under gravity', () => {
  const initial = {
    theta1: Math.PI / 2,
    theta2: Math.PI / 2,
    omega1: 0,
    omega2: 0,
    length1: 1,
    length2: 1,
    mass1: 1,
    mass2: 1,
    gravity: 9.82
  };
  const next = stepDoublePendulum(initial, 1 / 120);
  assert.ok(next.theta1 < initial.theta1);
  assert.ok(Math.abs(next.theta2 - initial.theta2) < 1e-5);
  assert.ok(next.omega1 < 0);
  assert.ok(Number.isFinite(next.energy));
});

test('rigid polygon world applies gravity while preserving its public body contract', () => {
  const world = {
    width: 2,
    height: 2,
    gravity: [0, -9.82],
    bodies: [{
      id: 'square',
      localVertices: [[-0.1, -0.1], [0.1, -0.1], [0.1, 0.1], [-0.1, 0.1]],
      position: [0, 0.5],
      velocity: [0, 0],
      angle: 0,
      angularVelocity: 0,
      mass: 1,
      restitution: 1,
      friction: 0
    }]
  };
  const next = stepRigidPolygonWorld2D(world, 0.1);
  assert.equal(next.bodies[0].id, 'square');
  assert.deepEqual(next.bodies[0].localVertices, world.bodies[0].localVertices);
  assert.ok(next.bodies[0].position[1] < 0.5);
  assert.ok(next.bodies[0].velocity[1] < 0);
});

test('rigid polygon bounces from the fixed centred 2x2 boundary with restitution', () => {
  const square = [[-0.1, -0.1], [0.1, -0.1], [0.1, 0.1], [-0.1, 0.1]];
  const next = stepRigidPolygonWorld2D({
    width: 2,
    height: 2,
    gravity: [0, 0],
    maxStep: 0.1,
    bodies: [{ localVertices: square, position: [0, -0.85], velocity: [0, -2], restitution: 1, friction: 0 }]
  }, 0.1);
  assert.ok(next.bodies[0].position[1] >= -0.9 - 1e-12);
  assert.ok(next.bodies[0].velocity[1] > 1.99);
});

test('convex rigid bodies exchange impulse and friction damps contact slip', () => {
  const square = [[-0.2, -0.2], [0.2, -0.2], [0.2, 0.2], [-0.2, 0.2]];
  const triangle = [[-0.2, -0.2], [0.2, -0.2], [0, 0.2]];
  const collide = (friction) => stepRigidPolygonWorld2D({
    width: 4,
    height: 4,
    gravity: [0, 0],
    maxStep: 0.05,
    bodies: [
      { id: 'square', localVertices: square, position: [-0.25, 0], velocity: [1, 0.4], mass: 1, restitution: 1, friction },
      { id: 'triangle', localVertices: triangle, position: [0.25, 0], velocity: [-1, 0], mass: 1, restitution: 1, friction }
    ]
  }, 0.1);
  const next = collide(0.8);
  const frictionless = collide(0);
  assert.ok(next.bodies[0].velocity[0] < 0);
  assert.ok(next.bodies[1].velocity[0] > 0);
  const slip = Math.abs(next.bodies[0].velocity[1] - next.bodies[1].velocity[1]);
  const frictionlessSlip = Math.abs(frictionless.bodies[0].velocity[1] - frictionless.bodies[1].velocity[1]);
  assert.ok(slip < frictionlessSlip);
});

test('disabled modules export no names while authored properties always remain', () => {
  const scope = createPhysicsScope({
    properties: { density: 4 },
    modules: [
      { id: 'off', enabled: false, exports: { F: [1, 0] } },
      { id: 'on', enabled: true, exports: { q: 2 } }
    ]
  });
  assert.deepEqual(scope, { density: 4, q: 2 });
  assert.throws(() => createPhysicsScope({
    properties: { q: 1 },
    modules: [{ id: 'em', enabled: true, exports: { q: 2 } }]
  }), /ambiguous physics symbol "q"/);
});

test('escaping geometry properties and enabled EM fields become globally sampleable', () => {
  const fields = createGlobalFieldRegistry({
    geometryProperties: [
      { name: 'wind', kind: 'vector', escapesGeometry: true, sample: () => [1, 0, 0] },
      { name: 'localOnly', escapesGeometry: false, sample: () => 3 }
    ],
    modules: [{
      id: 'em',
      enabled: true,
      globalFields: {
        E: { kind: 'vector', sample: ([x]) => [x, 0, 0] }
      }
    }]
  });
  assert.deepEqual([...fields.keys()], ['wind', 'E']);
  assert.deepEqual(sampleGlobalField(fields, 'wind', [2, 3, 4]), [1, 0, 0]);
  assert.deepEqual(sampleGlobalField(fields, 'E', [2, 0, 0]), [2, 0, 0]);
  assert.equal(fields.has('localOnly'), false);
});

test('inertia integrates F = p dot and tau = L dot', () => {
  const [body] = stepInertialBodies([{
    position: [0, 0, 0],
    momentum: [1, 0, 0],
    angularMomentum: [0, 0, 1],
    force: [2, 0, 0],
    torque: [0, 0, 3],
    mass: 2,
    inertia: [2, 2, 2]
  }], 0.5);
  assert.deepEqual(body.momentum, [2, 0, 0]);
  assert.deepEqual(body.angularMomentum, [0, 0, 2.5]);
  assert.deepEqual(body.velocity, [1, 0, 0]);
  assert.deepEqual(body.position, [0.5, 0, 0]);
  assert.deepEqual(body.angularVelocity, [0, 0, 1.25]);
});

test('thermal conduction conserves energy and emissivity radiates to the environment', () => {
  const conducted = stepThermalNetwork({
    temperatures: [400, 300],
    heatCapacities: [10, 10],
    conductanceEdges: [{ from: 0, to: 1, conductance: 0.5 }]
  }, 1);
  assert.deepEqual(conducted.temperatures, [395, 305]);
  assert.equal(conducted.energyDelta, 0);

  const radiated = stepThermalNetwork({
    temperatures: [400],
    heatCapacities: [100],
    radiationSurfaces: [{ node: 0, area: 2, emissivity: 0.8 }],
    environmentTemperature: 300
  }, 1);
  assert.ok(radiated.temperatures[0] < 400);
  assert.ok(radiated.radiatedEnergy < 0);
});

test('heat field diffuses a hot cell and enforces the explicit stability limit', () => {
  const next = stepHeatField({
    shape: [3, 3],
    spacing: [1, 1],
    temperature: [0, 0, 0, 0, 9, 0, 0, 0, 0],
    diffusivity: 0.1,
    boundary: 'insulated'
  }, 0.5);
  assert.ok(next.temperature[4] < 9);
  assert.ok(next.temperature[1] > 0);
  assert.throws(() => stepHeatField({
    shape: [3, 3], spacing: [1, 1], temperature: Array(9).fill(0), diffusivity: 1
  }, 1), /stability limit/);
});

test('Maxwell stepping evolves all vector components and rejects a CFL violation', () => {
  const shape = [3, 3, 3];
  const cells = 27;
  const electric = Array(cells * 3).fill(0);
  const magnetic = Array(cells * 3).fill(0);
  electric[(13 * 3) + 0] = 1;
  const state = {
    shape,
    spacing: [1, 1, 1],
    electric,
    magnetic,
    permittivity: 1,
    permeability: 1,
    boundary: MAXWELL_BOUNDARIES.PERIODIC
  };
  const dt = maxwellCflLimit(state) * 0.25;
  const next = stepMaxwellField(state, dt);
  assert.equal(next.electric.length, cells * 3);
  assert.equal(next.magnetic.length, cells * 3);
  assert.ok(next.magnetic.some((value) => value !== 0));
  assert.throws(() => stepMaxwellField(state, maxwellCflLimit(state) * 1.01), /CFL limit/);
});

test('electrostatic Poisson solve produces a finite potential and electric field', () => {
  const solved = solveElectrostaticPotential({
    shape: [5, 5],
    spacing: [1, 1],
    chargeDensity: Array.from({ length: 25 }, (_, index) => index === 12 ? 1 : 0),
    permittivity: 1,
    iterations: 200
  });
  assert.ok(solved.potential.every(Number.isFinite));
  assert.ok(solved.electric.every(Number.isFinite));
  assert.ok(solved.potential[12] > solved.potential[0]);
});
