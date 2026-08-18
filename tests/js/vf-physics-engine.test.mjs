import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAXWELL_BOUNDARIES,
  createGlobalFieldRegistry,
  createPhysicsScope,
  maxwellCflLimit,
  rigidBoundaryMassProperties2D,
  solveElectrostaticPotential,
  sampleGlobalField,
  stepDoublePendulum,
  stepHeatField,
  stepInertialBodies,
  stepMaxwellField,
  stepRigidPolygonWorld2D,
  stepThermalNetwork
} from '../../web/vf-ui/vf-physics-engine.mjs';

const stadiumBoundary = Object.freeze({
  type: 'boundary',
  edges: Object.freeze([
    Object.freeze({ type: 'segment', from: [-1, -1], to: [1, -1] }),
    Object.freeze({ type: 'arc', center: [1, 0], radius: 1, startAngle: -Math.PI / 2, sweepAngle: Math.PI }),
    Object.freeze({ type: 'segment', from: [1, 1], to: [-1, 1] }),
    Object.freeze({ type: 'arc', center: [-1, 0], radius: 1, startAngle: Math.PI / 2, sweepAngle: Math.PI })
  ])
});

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

test('rigid bodies leave an unbounded world when no boundary is authored', () => {
  const square = [[-0.1, -0.1], [0.1, -0.1], [0.1, 0.1], [-0.1, 0.1]];
  const next = stepRigidPolygonWorld2D({
    gravity: [0, 0],
    maxStep: 0.01,
    bodies: [{ localVertices: square, position: [0, 0], velocity: [10, 0], restitution: 0 }]
  }, 0.2);

  assert.ok(next.bodies[0].position[0] > 1.9);
  assert.ok(next.bodies[0].velocity[0] > 9.9);
  assert.equal(next.width, undefined);
  assert.equal(next.height, undefined);
});

test('an exact circular body stops tangent to an authored static segment', () => {
  const next = stepRigidPolygonWorld2D({
    gravity: [0, 0],
    maxStep: 0.01,
    segments: [{ id: 'floor', from: [-10, 0], to: [10, 0], restitution: 0, friction: 0 }],
    bodies: [{
      id: 'disc',
      shape: { type: 'circle', radius: 0.25 },
      position: [0, 0.255],
      velocity: [0, -1],
      restitution: 0,
      friction: 0
    }]
  }, 0.01);

  assert.ok(Math.abs(next.bodies[0].position[1] - 0.25) < 1e-12);
  assert.ok(Math.abs(next.bodies[0].velocity[1]) < 1e-12);
  assert.deepEqual(next.bodies[0].shape, { type: 'circle', radius: 0.25 });
});

test('a moving rigid segment transfers impact momentum to a circular body', () => {
  const next = stepRigidPolygonWorld2D({
    gravity: [0, 0],
    maxStep: 1 / 1000,
    segments: [{
      id: 'rod',
      from: [-1, -0.5],
      to: [1, -0.5],
      fromVelocity: [0, 12],
      toVelocity: [0, 12],
      e_n: 0.5,
      mu_s: 0,
      mu_d: 0
    }],
    bodies: [{
      id: 'disc',
      shape: { type: 'circle', radius: 0.2 },
      position: [0, 0.2],
      velocity: [0, 0],
      e_n: 0.5,
      mu_s: 0,
      mu_d: 0
    }]
  }, 0.05);

  assert.ok(next.bodies[0].velocity[1] > 17.9);
  assert.ok(next.bodies[0].position[1] >= 0.3 - 1e-12);
  assert.ok(Math.abs(next.segments[0].from[1] - 0.1) < 1e-12);
});

test('fast rigid motion cannot tunnel through a segment between authored steps', () => {
  const next = stepRigidPolygonWorld2D({
    gravity: [0, 0],
    maxStep: 0.05,
    segments: [{ from: [0, -1], to: [0, 1], e_n: 0, mu_s: 0, mu_d: 0 }],
    bodies: [{
      shape: { type: 'circle', radius: 0.2 },
      position: [-1, 0],
      velocity: [40, 0],
      e_n: 0,
      mu_s: 0,
      mu_d: 0
    }]
  }, 0.05).bodies[0];

  assert.ok(next.position[0] <= -0.2 + 1e-12);
  assert.ok(Math.abs(next.velocity[0]) < 1e-12);
});

test('exact circles exchange impulse without polygonizing their boundaries', () => {
  const next = stepRigidPolygonWorld2D({
    gravity: [0, 0],
    maxStep: 0.01,
    bodies: [
      { id: 'left', shape: { type: 'circle', radius: 0.25 }, position: [-0.255, 0], velocity: [1, 0], restitution: 1 },
      { id: 'right', shape: { type: 'circle', radius: 0.25 }, position: [0.255, 0], velocity: [-1, 0], restitution: 1 }
    ]
  }, 0.01);

  assert.ok(next.bodies[0].velocity[0] < -0.99);
  assert.ok(next.bodies[1].velocity[0] > 0.99);
  assert.ok(next.bodies[1].position[0] - next.bodies[0].position[0] >= 0.5 - 1e-12);
});

test('concentric exact circles choose a stable separating normal', () => {
  const next = stepRigidPolygonWorld2D({
    gravity: [0, 0],
    bodies: [
      { shape: { type: 'circle', radius: 1 }, position: [0, 0], static: true },
      { shape: { type: 'circle', radius: 0.5 }, position: [0, 0], velocity: [0, 0] }
    ]
  }, 0).bodies[1];

  assert.ok(Math.abs(next.position[0] - 1.5) < 1e-12);
  assert.ok(Math.abs(next.position[1]) < 1e-12);
});

test('an exact circle resolves tangentially against a convex solid body', () => {
  const square = [[-0.25, -0.25], [0.25, -0.25], [0.25, 0.25], [-0.25, 0.25]];
  const next = stepRigidPolygonWorld2D({
    gravity: [0, 0],
    maxStep: 0.01,
    bodies: [
      { id: 'disc', shape: { type: 'circle', radius: 0.2 }, position: [-0.455, 0], velocity: [1, 0], restitution: 0 },
      { id: 'block', localVertices: square, position: [0, 0], velocity: [0, 0], static: true, restitution: 0 }
    ]
  }, 0.01);

  assert.ok(next.bodies[0].position[0] <= -0.45 + 1e-12);
  assert.ok(Math.abs(next.bodies[0].velocity[0]) < 1e-12);
});

test('mixed segment and circular-arc boundaries have analytic mass properties', () => {
  const properties = rigidBoundaryMassProperties2D(stadiumBoundary);

  assert.ok(Math.abs(properties.area - (4 + Math.PI)) < 1e-12);
  assert.ok(Math.abs(properties.centroid[0]) < 1e-12);
  assert.ok(Math.abs(properties.centroid[1]) < 1e-12);
  assert.ok(Math.abs(properties.polarMoment - (16 / 3 + 3 * Math.PI / 2)) < 1e-12);
  assert.ok(Math.abs(properties.inertiaPerMass - properties.polarMoment / properties.area) < 1e-12);
});

test('clockwise full arcs retain exact area, centroid, and solid-disc inertia', () => {
  const properties = rigidBoundaryMassProperties2D({
    type: 'boundary',
    edges: [{ type: 'arc', center: [3, -2], radius: 2, startAngle: 0, sweepAngle: -2 * Math.PI }]
  });

  assert.ok(Math.abs(properties.area - 4 * Math.PI) < 1e-12);
  assert.ok(Math.abs(properties.centroid[0] - 3) < 1e-12);
  assert.ok(Math.abs(properties.centroid[1] + 2) < 1e-12);
  assert.ok(Math.abs(properties.polarMoment - 8 * Math.PI) < 1e-11);
  assert.ok(Math.abs(properties.inertiaPerMass - 2) < 1e-12);
});

test('a rotated mixed boundary uses exact curved support against a wall', () => {
  const angle = Math.PI / 2;
  const next = stepRigidPolygonWorld2D({
    width: 20,
    height: 4,
    gravity: [0, 0],
    maxStep: 0.01,
    bodies: [{
      shape: stadiumBoundary,
      position: [0, -0.51],
      angle,
      velocity: [0, -1],
      restitution: 0,
      friction: 0
    }]
  }, 0.01).bodies[0];

  assert.ok(Math.abs(next.position[1]) < 1e-12);
  assert.ok(Math.abs(next.velocity[1]) < 1e-12);
  assert.equal(next.angle, angle);
  assert.deepEqual(next.shape, stadiumBoundary);
});

test('mixed arc contact resolves along the analytic radial normal', () => {
  const initial = [2.2, 0.6];
  const expectedNormalLength = Math.hypot(1.2, 0.6);
  const expectedNormal = [1.2 / expectedNormalLength, 0.6 / expectedNormalLength];
  const next = stepRigidPolygonWorld2D({
    gravity: [0, 0],
    maxStep: 0.01,
    bodies: [
      { id: 'stadium', shape: stadiumBoundary, position: [0, 0], static: true },
      { id: 'disc', shape: { type: 'circle', radius: 0.5 }, position: initial, velocity: [-1, 0], restitution: 0 }
    ]
  }, 0).bodies[1];
  const correction = [next.position[0] - initial[0], next.position[1] - initial[1]];
  const correctionLength = Math.hypot(...correction);

  assert.ok(correctionLength > 0.15);
  assert.ok(Math.abs(correction[0] / correctionLength - expectedNormal[0]) < 1e-10);
  assert.ok(Math.abs(correction[1] / correctionLength - expectedNormal[1]) < 1e-10);
});

test('two mixed boundaries exchange centred impulse through their arc ends', () => {
  const next = stepRigidPolygonWorld2D({
    gravity: [0, 0],
    maxStep: 0.01,
    bodies: [
      { shape: stadiumBoundary, position: [-2.005, 0], velocity: [1, 0], mass: 1, restitution: 1, friction: 0 },
      { shape: stadiumBoundary, position: [2.005, 0], velocity: [-1, 0], mass: 1, restitution: 1, friction: 0 }
    ]
  }, 0.01).bodies;

  assert.ok(next[0].velocity[0] < -0.99);
  assert.ok(next[1].velocity[0] > 0.99);
  assert.ok(Math.abs(next[0].angularVelocity) < 1e-12);
  assert.ok(Math.abs(next[1].angularVelocity) < 1e-12);
});

test('off-centre arc contact rotates from the exact mixed-boundary inertia', () => {
  const inertia = rigidBoundaryMassProperties2D(stadiumBoundary).inertiaPerMass;
  const lever = Math.SQRT1_2;
  const expectedAngularVelocity = lever / (inertia + lever ** 2);
  const body = stepRigidPolygonWorld2D({
    gravity: [0, 0],
    segments: [{ from: [0, -10], to: [0, 10], restitution: 0, friction: 0 }],
    bodies: [{
      shape: stadiumBoundary,
      position: [-1.7, 0],
      angle: Math.PI / 4,
      velocity: [1, 0],
      mass: 1,
      restitution: 0,
      friction: 0
    }]
  }, 0).bodies[0];

  assert.ok(Math.abs(body.angularVelocity - expectedAngularVelocity) < 1e-12);
});

test('convex rigid bodies exchange centred impulse and friction damps contact slip', () => {
  const square = [[-0.2, -0.2], [0.2, -0.2], [0.2, 0.2], [-0.2, 0.2]];
  const collide = (friction) => stepRigidPolygonWorld2D({
    width: 4,
    height: 4,
    gravity: [0, 0],
    maxStep: 0.05,
    bodies: [
      { id: 'square', localVertices: square, position: [-0.25, -0.02], velocity: [1, 0.4], mass: 1, restitution: 1, friction },
      { id: 'right-square', localVertices: square, position: [0.25, 0], velocity: [-1, 0], mass: 1, restitution: 1, friction }
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

test('a long static edge resolves impact at the local contact instead of its midpoint', () => {
  const body = stepRigidPolygonWorld2D({
    width: 20,
    height: 20,
    gravity: [0, 0],
    maxStep: 1 / 1000,
    solverIterations: 12,
    bodies: [
      {
        localVertices: [[-0.16, -0.16], [0.16, -0.16], [0.16, 0.16], [-0.16, 0.16]],
        position: [-0.074, 0.48],
        velocity: [1, 0],
        mass: 1,
        e_n: 1,
        mu_s: 0,
        mu_d: 0
      },
      {
        localVertices: [[-1, -0.015], [1, -0.015], [1, 0.015], [-1, 0.015]],
        position: [0.1, 0],
        angle: Math.PI / 2,
        static: true,
        e_n: 1,
        mu_s: 0,
        mu_d: 0
      }
    ]
  }, 1 / 1000).bodies[0];

  assert.ok(body.velocity[0] < -0.99);
  assert.ok(Math.abs(body.angularVelocity) < 1e-9);
});

test('solid contact exposes e_n, e_t, mu_s, mu_d, and mu_r', () => {
  const square = [[-0.1, -0.1], [0.1, -0.1], [0.1, 0.1], [-0.1, 0.1]];
  const impact = (eT) => stepRigidPolygonWorld2D({
    width: 4,
    height: 2,
    gravity: [0, 0],
    maxStep: 0.1,
    bodies: [{
      localVertices: square,
      position: [0, -0.85],
      velocity: [1, -2],
      mass: 1,
      e_n: 0,
      e_t: eT,
      mu_s: 10,
      mu_d: 10,
      mu_r: 0
    }]
  }, 0.1).bodies[0];

  const stuck = impact(0);
  const reversed = impact(0.5);
  assert.ok(Math.abs(stuck.velocity[0] + 0.1 * stuck.angularVelocity) < 1e-12);
  assert.ok(Math.abs(reversed.velocity[0] + 0.1 * reversed.angularVelocity + 0.5) < 1e-12);
});

test('static friction holds a block on a shallow incline while dynamic friction lets it slide', () => {
  const rectangle = (halfWidth, halfHeight) => [
    [-halfWidth, -halfHeight], [halfWidth, -halfHeight],
    [halfWidth, halfHeight], [-halfWidth, halfHeight]
  ];
  const angle = 0.25;
  const normal = [-Math.sin(angle), Math.cos(angle)];
  const tangent = [Math.cos(angle), Math.sin(angle)];
  const slopePosition = [0, -1];
  const start = [slopePosition[0] + 0.2 * normal[0], slopePosition[1] + 0.2 * normal[1]];
  const displacement = (muS, muD) => {
    const body = stepRigidPolygonWorld2D({
      width: 20,
      height: 20,
      gravity: [0, -9.81],
      maxStep: 1 / 480,
      solverIterations: 12,
      bodies: [
        { localVertices: rectangle(4, 0.1), position: slopePosition, angle, static: true, e_n: 0, mu_s: muS, mu_d: muD },
        { localVertices: rectangle(0.1, 0.1), position: start, angle, mass: 1, e_n: 0, mu_s: muS, mu_d: muD }
      ]
    }, 0.5).bodies[1];
    return (body.position[0] - start[0]) * tangent[0]
      + (body.position[1] - start[1]) * tangent[1];
  };

  assert.ok(Math.abs(displacement(0.4, 0.3)) < 0.02);
  assert.ok(displacement(0.1, 0.08) < -0.1);
});

test('rolling resistance opposes relative angular motion without breaking no-slip rolling', () => {
  const radius = 0.1;
  const circle = Array.from({ length: 32 }, (_, index) => {
    const angle = 2 * Math.PI * index / 32;
    return [radius * Math.cos(angle), radius * Math.sin(angle)];
  });
  const roll = (muR) => stepRigidPolygonWorld2D({
    width: 10,
    height: 2,
    gravity: [0, -9.81],
    maxStep: 1 / 480,
    solverIterations: 8,
    bodies: [{
      localVertices: circle,
      position: [0, -0.9],
      velocity: [1, 0],
      angular_velocity: -10,
      mass: 1,
      e_n: 0,
      mu_s: 0.9,
      mu_d: 0.7,
      mu_r: muR,
      contact_radius: radius
    }]
  }, 0.5).bodies[0];

  const free = roll(0);
  const resisted = roll(0.02);
  assert.ok(resisted.velocity[0] < free.velocity[0]);
  assert.ok(Math.abs(resisted.velocity[0] + radius * resisted.angularVelocity) < 0.01);
});

test('dynamic sliding acceleration scales as minus mu_d times gravitational load', () => {
  const square = [[-0.1, -0.1], [0.1, -0.1], [0.1, 0.1], [-0.1, 0.1]];
  const muD = 0.2;
  const dt = 1 / 1000;
  for (const gravity of [4, 9.81, 15]) {
    const body = stepRigidPolygonWorld2D({
      width: 20,
      height: 2,
      gravity: [0, -gravity],
      maxStep: dt,
      bodies: [{
        localVertices: square,
        position: [0, -0.9],
        velocity: [5, 0],
        mass: 1,
        e_n: 0,
        mu_s: 0.4,
        mu_d: muD
      }]
    }, dt).bodies[0];
    const acceleration = (body.velocity[0] - 5) / dt;
    assert.ok(Math.abs(acceleration + muD * gravity) < 1e-9);
  }
});

test('a no-slip solid disc rolls down an incline at two-thirds g sin(theta)', () => {
  const rectangle = (halfWidth, halfHeight) => [
    [-halfWidth, -halfHeight], [halfWidth, -halfHeight],
    [halfWidth, halfHeight], [-halfWidth, halfHeight]
  ];
  const radius = 0.1;
  const circle = Array.from({ length: 96 }, (_, index) => {
    const angle = 2 * Math.PI * index / 96;
    return [radius * Math.cos(angle), radius * Math.sin(angle)];
  });
  const angle = 0.2;
  const normal = [-Math.sin(angle), Math.cos(angle)];
  const tangent = [Math.cos(angle), Math.sin(angle)];
  const slopePosition = [0, -1];
  const start = [slopePosition[0] + 0.2 * normal[0], slopePosition[1] + 0.2 * normal[1]];
  const duration = 0.05;
  const body = stepRigidPolygonWorld2D({
    width: 20,
    height: 20,
    gravity: [0, -9.81],
    maxStep: 1 / 1000,
    solverIterations: 16,
    sleepDelay: 100,
    bodies: [
      { localVertices: rectangle(5, 0.1), position: slopePosition, angle, static: true, e_n: 0, mu_s: 1, mu_d: 0.8 },
      { localVertices: circle, position: start, mass: 1, e_n: 0, mu_s: 1, mu_d: 0.8, mu_r: 0, contact_radius: radius }
    ]
  }, duration).bodies[1];
  const acceleration = (body.velocity[0] * tangent[0] + body.velocity[1] * tangent[1]) / duration;
  const expected = -(2 / 3) * 9.81 * Math.sin(angle);
  assert.ok(Math.abs((acceleration - expected) / expected) < 0.03);
  assert.ok(Math.abs(
    body.velocity[0] * tangent[0] + body.velocity[1] * tangent[1] + radius * body.angularVelocity
  ) < 1e-4);
});

test('dissipative contact settles bounce, slide, and roll to exact persistent rest', () => {
  const square = [[-0.1, -0.1], [0.1, -0.1], [0.1, 0.1], [-0.1, 0.1]];
  const radius = 0.1;
  const circle = Array.from({ length: 64 }, (_, index) => {
    const angle = 2 * Math.PI * index / 64;
    return [radius * Math.cos(angle), radius * Math.sin(angle)];
  });
  const cases = [
    { localVertices: square, position: [0, 0], velocity: [0, -1], mass: 1, e_n: 0.5, mu_s: 0, mu_d: 0, mu_r: 0 },
    { localVertices: square, position: [0, -0.9], velocity: [1, 0], mass: 1, e_n: 0, mu_s: 0.4, mu_d: 0.2, mu_r: 0.02, contact_radius: radius },
    { localVertices: circle, position: [0, -0.9], velocity: [1, 0], angular_velocity: -10, mass: 1, e_n: 0, mu_s: 0.8, mu_d: 0.6, mu_r: 0.02, contact_radius: radius }
  ];
  for (const initial of cases) {
    const world = {
      width: 20,
      height: 2,
      gravity: [0, -9.81],
      maxStep: 1 / 480,
      solverIterations: 12,
      bodies: [initial]
    };
    const settled = stepRigidPolygonWorld2D(world, 8);
    const body = settled.bodies[0];
    assert.deepEqual(body.velocity, [0, 0]);
    assert.equal(body.angularVelocity, 0);
    assert.equal(body.sleeping, true);
    const persisted = stepRigidPolygonWorld2D({ ...world, bodies: settled.bodies }, 1).bodies[0];
    assert.deepEqual(persisted.velocity, [0, 0]);
    assert.equal(persisted.angularVelocity, 0);
  }
});

test('solid contact rejects dynamic friction above static friction', () => {
  assert.throws(() => stepRigidPolygonWorld2D({
    bodies: [{
      localVertices: [[0, 0], [1, 0], [0, 1]],
      mu_s: 0.2,
      mu_d: 0.3
    }]
  }, 0), /mu_d <= mu_s/);
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
