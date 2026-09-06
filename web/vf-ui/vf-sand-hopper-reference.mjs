const FIXED_STEP = 1 / 120;
const SOLVER_ITERATIONS = 4;
const GRAVITY = -9.82;

export const DRY_SAND_PRESETS = Object.freeze({
  standard: Object.freeze({ id: 'standard', diameter: 0.052, sizeSpread: 0,
    aspectMin: 0.78, aspectRange: 0.44, transverseMin: 0.88, transverseRange: 0.20,
    friction: 0.58, rollingResistance: 0.12, restitution: 0.04 }),
  fine: Object.freeze({ id: 'fine', diameter: 0.042, sizeSpread: 0.12,
    aspectMin: 0.86, aspectRange: 0.24, transverseMin: 0.92, transverseRange: 0.12,
    friction: 0.52, rollingResistance: 0.08, restitution: 0.05 }),
  coarse: Object.freeze({ id: 'coarse', diameter: 0.065, sizeSpread: 0.22,
    aspectMin: 0.72, aspectRange: 0.48, transverseMin: 0.82, transverseRange: 0.28,
    friction: 0.66, rollingResistance: 0.16, restitution: 0.03 }),
});

function mix32(value) {
  let word = value >>> 0;
  word ^= word >>> 16;
  word = Math.imul(word, 0x7feb352d) >>> 0;
  word ^= word >>> 15;
  word = Math.imul(word, 0x846ca68b) >>> 0;
  word ^= word >>> 16;
  return word >>> 0;
}

function unit(seed, lane) {
  return mix32(seed ^ Math.imul(lane + 1, 0x9e3779b1)) / 0x100000000;
}

function finitePositive(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new RangeError(`${name} must be finite and positive`);
  return number;
}

function initialGrains({ seed, grainCount, radius, fillHeightInGrains, hopperBottom, hopperTop, hopperRadius, outletRadius, preset }) {
  const positions = new Float32Array(grainCount * 3);
  const velocities = new Float32Array(grainCount * 3);
  const orientations = new Float32Array(grainCount * 4);
  const angularVelocities = new Float32Array(grainCount * 3);
  const aspects = new Float32Array(grainCount * 3);
  const sizeScales = new Float32Array(grainCount);
  const spacing = radius * 2.08;
  const verticalSpacing = spacing * 0.84;
  const requestedTop = hopperBottom + Math.max(8, fillHeightInGrains) * radius * 2;
  let index = 0;
  for (let layer = 0; index < grainCount; layer += 1) {
    const z = hopperBottom + radius * 1.2 + layer * verticalSpacing;
    const cappedZ = Math.min(z, requestedTop, hopperTop - radius);
    const path = (cappedZ - hopperBottom) / (hopperTop - hopperBottom);
    const allowed = outletRadius + (hopperRadius - outletRadius) * Math.max(0, Math.min(1, path)) - radius * 1.1;
    const extent = Math.max(1, Math.floor(allowed / spacing));
    let emitted = false;
    for (let row = -extent; row <= extent && index < grainCount; row += 1) {
      for (let col = -extent; col <= extent && index < grainCount; col += 1) {
        const x = (col + ((row + layer) & 1) * 0.5) * spacing;
        const y = row * spacing * 0.866;
        if (Math.hypot(x, y) > allowed) continue;
        const offset = index * 3;
        const jitter = radius * 0.045;
        positions[offset] = x + (unit(seed, index * 7) - 0.5) * jitter;
        positions[offset + 1] = y + (unit(seed, index * 7 + 1) - 0.5) * jitter;
        positions[offset + 2] = cappedZ + (unit(seed, index * 7 + 2) - 0.5) * jitter;
        orientations[index * 4 + 2] = Math.sin(unit(seed, index * 7 + 3) * Math.PI);
        orientations[index * 4 + 3] = Math.cos(unit(seed, index * 7 + 3) * Math.PI);
        const normal = (unit(seed, index * 11 + 7) + unit(seed, index * 11 + 8)
          + unit(seed, index * 11 + 9) + unit(seed, index * 11 + 10) - 2) * 0.5;
        sizeScales[index] = 1 + normal * preset.sizeSpread;
        const stretch = preset.aspectMin + unit(seed, index * 7 + 4) * preset.aspectRange;
        aspects[offset] = stretch;
        aspects[offset + 1] = preset.transverseMin + unit(seed, index * 7 + 5) * preset.transverseRange;
        aspects[offset + 2] = preset.transverseMin + unit(seed, index * 7 + 6) * preset.transverseRange;
        index += 1;
        emitted = true;
      }
    }
    if (!emitted || cappedZ >= hopperTop - radius) {
      throw new RangeError('grain count exceeds bounded hopper fill capacity');
    }
  }
  return { positions, velocities, orientations, angularVelocities, aspects, sizeScales };
}

export function createDrySandHopperReference({
  seed = 0x5a17,
  grainCount = 384,
  grainDiameter,
  outletDiameterInGrains = 4,
  fillHeightInGrains = 20,
  preset = 'standard',
} = {}) {
  const profile = DRY_SAND_PRESETS[preset];
  if (!profile) throw new RangeError('sand preset must be standard, fine, or coarse');
  const count = Math.trunc(finitePositive(grainCount, 'grainCount'));
  const diameter = finitePositive(grainDiameter ?? profile.diameter, 'grainDiameter');
  const radius = diameter * 0.5;
  const hopperBottom = 0.72;
  const hopperTop = 2.45;
  const hopperRadius = 0.66;
  const outletRadius = diameter * finitePositive(outletDiameterInGrains, 'outletDiameterInGrains') * 0.5;
  const initial = initialGrains({
    seed: seed >>> 0, grainCount: count, radius, fillHeightInGrains,
    hopperBottom, hopperTop, hopperRadius, outletRadius, preset: profile,
  });
  const state = {
    positions: initial.positions.slice(),
    velocities: initial.velocities.slice(),
    orientations: initial.orientations.slice(),
    angularVelocities: initial.angularVelocities.slice(),
    aspects: initial.aspects.slice(),
    sizeScales: initial.sizeScales.slice(),
    discharged: new Uint8Array(count),
    dischargedAt: new Float32Array(count).fill(-1),
    aggregated: new Uint8Array(count),
    obstacleContacted: new Uint8Array(count),
  };
  return {
    kind: 'dry-sand-hopper-reference:v1', seed: seed >>> 0, count,
    radius, diameter, maximumDiameter: diameter * (1 + profile.sizeSpread),
    hopperBottom, hopperTop, hopperRadius, outletRadius,
    outletDiameterInMeanGrains: outletRadius / radius,
    fixedStep: FIXED_STEP, solverIterations: SOLVER_ITERATIONS, time: 0,
    preset: profile,
    friction: profile.friction, rollingResistance: profile.rollingResistance, restitution: profile.restitution,
    state,
    render: { positions: state.positions, orientations: state.orientations,
      aspects: state.aspects, sizeScales: state.sizeScales },
    initial: Object.freeze({
      positions: initial.positions, velocities: initial.velocities,
      orientations: initial.orientations, angularVelocities: initial.angularVelocities,
      aspects: initial.aspects,
      sizeScales: initial.sizeScales,
    }),
    maxPersistentPenetration: 0,
    baseTilt: Object.freeze({ degrees: 0, azimuthRadians: 0, slopeX: 0, slopeY: 0, inverseNormal: 1 }),
    archLocked: false,
    _archLastDischargedCount: 0,
    _archStableSteps: 0,
    flowDiagnostic: Object.freeze({ status: 'flowing', outletDiameterInMeanGrains: outletRadius / radius }),
    receivingObstacle: null,
  };
}

export function resetDrySandHopperReference(world) {
  world.state.positions.set(world.initial.positions);
  world.state.velocities.set(world.initial.velocities);
  world.state.orientations.set(world.initial.orientations);
  world.state.angularVelocities.set(world.initial.angularVelocities);
  world.state.aspects.set(world.initial.aspects);
  world.state.sizeScales.set(world.initial.sizeScales);
  world.state.discharged.fill(0);
  world.state.dischargedAt.fill(-1);
  world.state.aggregated.fill(0);
  world.state.obstacleContacted.fill(0);
  world.time = 0;
  world.maxPersistentPenetration = 0;
  world.baseTilt = Object.freeze({ degrees: 0, azimuthRadians: 0, slopeX: 0, slopeY: 0, inverseNormal: 1 });
  world.archLocked = false;
  world._archLastDischargedCount = 0;
  world._archStableSteps = 0;
  world.flowDiagnostic = Object.freeze({
    status: 'flowing', outletDiameterInMeanGrains: world.outletDiameterInMeanGrains,
  });
  return world;
}

export function setDrySandReceivingObstacleReference(world, { center, radii } = {}) {
  if (!Array.isArray(center) || center.length !== 3 || !center.every(Number.isFinite)) {
    throw new RangeError('receiving obstacle center must contain three finite coordinates');
  }
  if (!Array.isArray(radii) || radii.length !== 3
      || !radii.every(value => Number.isFinite(value) && value > 0)) {
    throw new RangeError('receiving obstacle radii must contain three finite positive values');
  }
  world.receivingObstacle = Object.freeze({
    kind: 'ellipsoid', center: Object.freeze([...center]), radii: Object.freeze([...radii]),
  });
  world.state.obstacleContacted.fill(0);
  return world;
}

export function removeDrySandReceivingObstacleReference(world) {
  world.receivingObstacle = null;
  return world;
}

function grainRadius(world, index) {
  return world.radius * world.state.sizeScales[index];
}

export function setDrySandBaseTiltReference(world, { degrees = 0, azimuthRadians = 0 } = {}) {
  const tilt = Number(degrees); const azimuth = Number(azimuthRadians);
  if (!Number.isFinite(tilt) || Math.abs(tilt) > 28) {
    throw new RangeError('base tilt must be finite and within +/-28 degrees');
  }
  if (!Number.isFinite(azimuth)) throw new RangeError('base tilt azimuth must be finite');
  const rotateSupported = (radians, direction) => {
    if (Math.abs(radians) < 1e-12) return;
    const ux = Math.cos(direction); const uy = Math.sin(direction);
    const cosine = Math.cos(radians); const sine = Math.sin(radians);
    for (let index = 0; index < world.count; index += 1) {
      if (!world.state.discharged[index]) continue;
      const offset = index * 3;
      const along = world.state.positions[offset] * ux + world.state.positions[offset + 1] * uy;
      const acrossX = world.state.positions[offset] - along * ux;
      const acrossY = world.state.positions[offset + 1] - along * uy;
      const height = world.state.positions[offset + 2];
      const rotatedAlong = cosine * along - sine * height;
      world.state.positions[offset] = acrossX + rotatedAlong * ux;
      world.state.positions[offset + 1] = acrossY + rotatedAlong * uy;
      world.state.positions[offset + 2] = sine * along + cosine * height;
      const speedAlong = world.state.velocities[offset] * ux + world.state.velocities[offset + 1] * uy;
      const speedAcrossX = world.state.velocities[offset] - speedAlong * ux;
      const speedAcrossY = world.state.velocities[offset + 1] - speedAlong * uy;
      const speedHeight = world.state.velocities[offset + 2];
      const rotatedSpeed = cosine * speedAlong - sine * speedHeight;
      world.state.velocities[offset] = speedAcrossX + rotatedSpeed * ux;
      world.state.velocities[offset + 1] = speedAcrossY + rotatedSpeed * uy;
      world.state.velocities[offset + 2] = sine * speedAlong + cosine * speedHeight;
    }
  };
  rotateSupported(-world.baseTilt.degrees * Math.PI / 180, world.baseTilt.azimuthRadians);
  rotateSupported(tilt * Math.PI / 180, azimuth);
  const slope = Math.tan(tilt * Math.PI / 180);
  const slopeX = slope * Math.cos(azimuth); const slopeY = slope * Math.sin(azimuth);
  world.baseTilt = Object.freeze({
    degrees: tilt, azimuthRadians: azimuth, slopeX, slopeY,
    inverseNormal: 1 / Math.sqrt(1 + slopeX * slopeX + slopeY * slopeY),
  });
  return world;
}

function projectBoundaries(world, previous) {
  const p = world.state.positions;
  const v = world.state.velocities;
  let maxPenetration = 0;
  for (let index = 0; index < world.count; index += 1) {
    const offset = index * 3;
    const r = grainRadius(world, index);
    let x = p[offset]; let y = p[offset + 1]; let z = p[offset + 2];
    if (world.baseTilt.degrees === 0) {
      if (z < r) {
        maxPenetration = Math.max(maxPenetration, r - z);
        z = r;
        const slip = Math.max(0, 1 - world.friction * 0.15);
        v[offset] *= slip; v[offset + 1] *= slip;
      }
    } else {
      const { slopeX, slopeY, inverseNormal } = world.baseTilt;
      const distance = (z - slopeX * x - slopeY * y) * inverseNormal;
      if (distance < r) {
        const penetration = r - distance;
        const nx = -slopeX * inverseNormal; const ny = -slopeY * inverseNormal;
        x += nx * penetration; y += ny * penetration; z += inverseNormal * penetration;
        maxPenetration = Math.max(maxPenetration, penetration);
      }
    }
    const obstacle = world.receivingObstacle;
    if (obstacle && z < world.hopperBottom - r) {
      const [cx, cy, cz] = obstacle.center;
      const ex = obstacle.radii[0] + r;
      const ey = obstacle.radii[1] + r;
      const ez = obstacle.radii[2] + r;
      const dx = x - cx; const dy = y - cy; const dz = z - cz;
      const normalized = Math.hypot(dx / ex, dy / ey, dz / ez);
      if (normalized < 1) {
        if (normalized < 1e-12) {
          x = cx - ex;
        } else {
          const scale = 1 / normalized;
          const targetZ = cz + dz * scale;
          if (targetZ >= r) {
            x = cx + dx * scale; y = cy + dy * scale; z = targetZ;
          } else {
            z = r;
            const vertical = Math.max(-1, Math.min(1, (z - cz) / ez));
            const crossSection = Math.sqrt(Math.max(0, 1 - vertical * vertical));
            const radial = Math.hypot(dx / ex, dy / ey);
            const directionX = radial > 1e-12 ? dx / ex / radial : -1;
            const directionY = radial > 1e-12 ? dy / ey / radial : 0;
            x = cx + directionX * ex * crossSection;
            y = cy + directionY * ey * crossSection;
          }
        }
        world.state.obstacleContacted[index] = 1;
      }
    }
    if (z >= world.hopperBottom - r && z <= world.hopperTop + r) {
      const path = Math.max(0, Math.min(1, (z - world.hopperBottom) / (world.hopperTop - world.hopperBottom)));
      const wallRadius = world.outletRadius + (world.hopperRadius - world.outletRadius) * path;
      const radial = Math.hypot(x, y) || 1e-12;
      const allowed = wallRadius - r;
      if (radial > allowed) {
        const penetration = radial - allowed;
        maxPenetration = Math.max(maxPenetration, penetration);
        x -= x / radial * penetration;
        y -= y / radial * penetration;
      }
      const radialNow = Math.hypot(x, y);
      const wasAbove = previous[offset + 2] >= world.hopperBottom + r;
      const plateBlocks = radialNow + r > world.outletRadius || world.archLocked;
      if (z < world.hopperBottom + r && plateBlocks
          && (wasAbove || (world.archLocked && !world.state.discharged[index]))) {
        maxPenetration = Math.max(maxPenetration, world.hopperBottom + r - z);
        z = world.hopperBottom + r;
      }
      if (!world.state.discharged[index] && z < world.hopperBottom + world.diameter * 4) {
        const effectiveOpening = Math.max(r, world.outletRadius - r * 1.5);
        const terminalSpeed = Math.sqrt(Math.abs(GRAVITY) * effectiveOpening) * 0.72;
        z = Math.max(z, previous[offset + 2] - terminalSpeed * world.fixedStep);
      }
    }
    p[offset] = x; p[offset + 1] = y; p[offset + 2] = z;
  }
  return maxPenetration;
}

function applyGrainFriction(world, incoming) {
  const p = world.state.positions;
  const v = world.state.velocities;
  const omega = world.state.angularVelocities;
  const inverse = 1 / world.maximumDiameter;
  const cells = new Map();
  for (let index = 0; index < world.count; index += 1) {
    const offset = index * 3;
    const cx = Math.floor(p[offset] * inverse);
    const cy = Math.floor(p[offset + 1] * inverse);
    const cz = Math.floor(p[offset + 2] * inverse);
    for (let dz = -1; dz <= 1; dz += 1) for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
      const bucket = cells.get(`${cx + dx}:${cy + dy}:${cz + dz}`);
      if (!bucket) continue;
      for (const other of bucket) {
        const oo = other * 3;
        const nx0 = p[offset] - p[oo];
        const ny0 = p[offset + 1] - p[oo + 1];
        const nz0 = p[offset + 2] - p[oo + 2];
        const distance = Math.hypot(nx0, ny0, nz0);
        const radius = grainRadius(world, index); const otherRadius = grainRadius(world, other);
        if (distance > (radius + otherRadius) * 1.025 || distance < 1e-9) continue;
        const nx = nx0 / distance; const ny = ny0 / distance; const nz = nz0 / distance;
        const spinX = omega[offset] + omega[oo];
        const spinY = omega[offset + 1] + omega[oo + 1];
        const spinZ = omega[offset + 2] + omega[oo + 2];
        const rvx = v[offset] - v[oo]
          - (radius * omega[offset + 1] + otherRadius * omega[oo + 1]) * nz
          + (radius * omega[offset + 2] + otherRadius * omega[oo + 2]) * ny;
        const rvy = v[offset + 1] - v[oo + 1]
          - (radius * omega[offset + 2] + otherRadius * omega[oo + 2]) * nx
          + (radius * omega[offset] + otherRadius * omega[oo]) * nz;
        const rvz = v[offset + 2] - v[oo + 2]
          - (radius * omega[offset] + otherRadius * omega[oo]) * ny
          + (radius * omega[offset + 1] + otherRadius * omega[oo + 1]) * nx;
        const normalSpeed = rvx * nx + rvy * ny + rvz * nz;
        const tx = rvx - normalSpeed * nx;
        const ty = rvy - normalSpeed * ny;
        const tz = rvz - normalSpeed * nz;
        const tangentSpeed = Math.hypot(tx, ty, tz);
        const incomingNormal = (incoming[offset] - incoming[oo]) * nx
          + (incoming[offset + 1] - incoming[oo + 1]) * ny
          + (incoming[offset + 2] - incoming[oo + 2]) * nz;
        const normalImpulse = Math.max(
          -(1 + world.restitution) * Math.min(0, incomingNormal) * 0.5,
          Math.abs(GRAVITY) * world.fixedStep * 0.5,
        );
        const tangentImpulse = Math.min(tangentSpeed * 0.5, world.friction * normalImpulse);
        const scale = tangentSpeed > 1e-12 ? tangentImpulse / tangentSpeed : 0;
        v[offset] -= tx * scale; v[offset + 1] -= ty * scale; v[offset + 2] -= tz * scale;
        v[oo] += tx * scale; v[oo + 1] += ty * scale; v[oo + 2] += tz * scale;
        const torqueX = ny * tz - nz * ty;
        const torqueY = nz * tx - nx * tz;
        const torqueZ = nx * ty - ny * tx;
        const spin = scale * 0.36 / Math.max(radius, otherRadius);
        omega[offset] += torqueX * spin; omega[offset + 1] += torqueY * spin; omega[offset + 2] += torqueZ * spin;
        omega[oo] -= torqueX * spin; omega[oo + 1] -= torqueY * spin; omega[oo + 2] -= torqueZ * spin;
        const rolling = 1 - world.rollingResistance * 0.5;
        omega[offset] *= rolling; omega[offset + 1] *= rolling; omega[offset + 2] *= rolling;
        omega[oo] *= rolling; omega[oo + 1] *= rolling; omega[oo + 2] *= rolling;
      }
    }
    const key = `${cx}:${cy}:${cz}`;
    const bucket = cells.get(key);
    if (bucket) bucket.push(index); else cells.set(key, [index]);
  }
}

function applyGrainRestitution(world, incoming) {
  const p = world.state.positions;
  const v = world.state.velocities;
  const inverse = 1 / world.maximumDiameter;
  const cells = new Map();
  for (let index = 0; index < world.count; index += 1) {
    const offset = index * 3;
    const cx = Math.floor(p[offset] * inverse);
    const cy = Math.floor(p[offset + 1] * inverse);
    const cz = Math.floor(p[offset + 2] * inverse);
    for (let dz = -1; dz <= 1; dz += 1) for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
      const bucket = cells.get(`${cx + dx}:${cy + dy}:${cz + dz}`);
      if (!bucket) continue;
      for (const other of bucket) {
        const oo = other * 3;
        const nx0 = p[offset] - p[oo];
        const ny0 = p[offset + 1] - p[oo + 1];
        const nz0 = p[offset + 2] - p[oo + 2];
        const distance = Math.hypot(nx0, ny0, nz0);
        const pairRadius = grainRadius(world, index) + grainRadius(world, other);
        if (distance > pairRadius * 1.025 || distance < 1e-9) continue;
        const nx = nx0 / distance; const ny = ny0 / distance; const nz = nz0 / distance;
        const incomingNormal = (incoming[offset] - incoming[oo]) * nx
          + (incoming[offset + 1] - incoming[oo + 1]) * ny
          + (incoming[offset + 2] - incoming[oo + 2]) * nz;
        if (incomingNormal >= 0) continue;
        const currentNormal = (v[offset] - v[oo]) * nx
          + (v[offset + 1] - v[oo + 1]) * ny
          + (v[offset + 2] - v[oo + 2]) * nz;
        const impulse = (-world.restitution * incomingNormal - currentNormal) * 0.5;
        v[offset] += impulse * nx; v[offset + 1] += impulse * ny; v[offset + 2] += impulse * nz;
        v[oo] -= impulse * nx; v[oo + 1] -= impulse * ny; v[oo + 2] -= impulse * nz;
      }
    }
    const key = `${cx}:${cy}:${cz}`;
    const bucket = cells.get(key);
    if (bucket) bucket.push(index); else cells.set(key, [index]);
  }
}

function integrateOrientations(world, dt) {
  const q = world.state.orientations;
  const omega = world.state.angularVelocities;
  for (let index = 0; index < world.count; index += 1) {
    const qo = index * 4; const vo = index * 3;
    const x = q[qo]; const y = q[qo + 1]; const z = q[qo + 2]; const w = q[qo + 3];
    const wx = omega[vo]; const wy = omega[vo + 1]; const wz = omega[vo + 2];
    const half = dt * 0.5;
    const nx = x + half * (wx * w + wy * z - wz * y);
    const ny = y + half * (-wx * z + wy * w + wz * x);
    const nz = z + half * (wx * y - wy * x + wz * w);
    const nw = w + half * (-wx * x - wy * y - wz * z);
    const inverse = 1 / Math.hypot(nx, ny, nz, nw);
    q[qo] = nx * inverse; q[qo + 1] = ny * inverse;
    q[qo + 2] = nz * inverse; q[qo + 3] = nw * inverse;
  }
}

function remainingPenetration(world) {
  const p = world.state.positions;
  const inverse = 1 / world.maximumDiameter;
  const cells = new Map();
  let maximum = 0;
  for (let index = 0; index < world.count; index += 1) {
    const offset = index * 3;
    const cx = Math.floor(p[offset] * inverse);
    const cy = Math.floor(p[offset + 1] * inverse);
    const cz = Math.floor(p[offset + 2] * inverse);
    for (let dz = -1; dz <= 1; dz += 1) for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
      const bucket = cells.get(`${cx + dx}:${cy + dy}:${cz + dz}`);
      if (!bucket) continue;
      for (const other of bucket) {
        const oo = other * 3;
        maximum = Math.max(maximum, grainRadius(world, index) + grainRadius(world, other) - Math.hypot(
          p[offset] - p[oo], p[offset + 1] - p[oo + 1], p[offset + 2] - p[oo + 2],
        ));
      }
    }
    const key = `${cx}:${cy}:${cz}`;
    const bucket = cells.get(key);
    if (bucket) bucket.push(index); else cells.set(key, [index]);
  }
  return Math.max(0, maximum);
}

function projectGrains(world) {
  const p = world.state.positions;
  const inverse = 1 / world.maximumDiameter;
  const cells = new Map();
  let maxPenetration = 0;
  for (let index = 0; index < world.count; index += 1) {
    const offset = index * 3;
    const cx = Math.floor(p[offset] * inverse);
    const cy = Math.floor(p[offset + 1] * inverse);
    const cz = Math.floor(p[offset + 2] * inverse);
    for (let dz = -1; dz <= 1; dz += 1) for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
      const bucket = cells.get(`${cx + dx}:${cy + dy}:${cz + dz}`);
      if (!bucket) continue;
      for (const other of bucket) {
        const oo = other * 3;
        let nx = p[offset] - p[oo];
        let ny = p[offset + 1] - p[oo + 1];
        let nz = p[offset + 2] - p[oo + 2];
        let distance = Math.hypot(nx, ny, nz);
        const pairRadius = grainRadius(world, index) + grainRadius(world, other);
        if (distance >= pairRadius) continue;
        if (distance < 1e-9) {
          const angle = unit(world.seed, index * 4099 + other) * Math.PI * 2;
          nx = Math.cos(angle); ny = Math.sin(angle); nz = 0; distance = 1;
        } else { nx /= distance; ny /= distance; nz /= distance; }
        const penetration = pairRadius - distance;
        maxPenetration = Math.max(maxPenetration, penetration);
        const correction = penetration * 0.5;
        p[offset] += nx * correction; p[offset + 1] += ny * correction; p[offset + 2] += nz * correction;
        p[oo] -= nx * correction; p[oo + 1] -= ny * correction; p[oo + 2] -= nz * correction;
      }
    }
    const key = `${cx}:${cy}:${cz}`;
    const bucket = cells.get(key);
    if (bucket) bucket.push(index); else cells.set(key, [index]);
  }
  return maxPenetration;
}

export function stepDrySandHopperReference(world, steps = 1) {
  const count = Math.max(0, Math.trunc(steps));
  const dt = world.fixedStep;
  const p = world.state.positions;
  const v = world.state.velocities;
  const previous = new Float32Array(p.length);
  const incoming = new Float32Array(v.length);
  for (let step = 0; step < count; step += 1) {
    previous.set(p);
    incoming.set(v);
    for (let index = 0; index < world.count; index += 1) {
      const offset = index * 3;
      v[offset + 2] += GRAVITY * dt;
      p[offset] += v[offset] * dt;
      p[offset + 1] += v[offset + 1] * dt;
      p[offset + 2] += v[offset + 2] * dt;
    }
    for (let iteration = 0; iteration < world.solverIterations; iteration += 1) {
      projectBoundaries(world, previous);
      projectGrains(world);
    }
    projectBoundaries(world, previous);
    const persistentPenetration = remainingPenetration(world);
    world.maxPersistentPenetration = persistentPenetration;
    for (let index = 0; index < world.count; index += 1) {
      const offset = index * 3;
      const radius = grainRadius(world, index);
      v[offset] = (p[offset] - previous[offset]) / dt * 0.985;
      v[offset + 1] = (p[offset + 1] - previous[offset + 1]) / dt * 0.985;
      v[offset + 2] = (p[offset + 2] - previous[offset + 2]) / dt * 0.992;
      const baseDistance = world.baseTilt.degrees === 0 ? p[offset + 2]
        : (p[offset + 2] - world.baseTilt.slopeX * p[offset]
          - world.baseTilt.slopeY * p[offset + 1]) * world.baseTilt.inverseNormal;
      if (baseDistance <= radius * 1.02) {
        if (world.baseTilt.degrees !== 0) {
          const nx = -world.baseTilt.slopeX * world.baseTilt.inverseNormal;
          const ny = -world.baseTilt.slopeY * world.baseTilt.inverseNormal;
          const nz = world.baseTilt.inverseNormal;
          const inward = Math.min(0, v[offset] * nx + v[offset + 1] * ny + v[offset + 2] * nz);
          v[offset] -= inward * nx; v[offset + 1] -= inward * ny; v[offset + 2] -= inward * nz;
          const retain = Math.max(0.2, 1 - world.friction * 0.6);
          v[offset] *= retain; v[offset + 1] *= retain; v[offset + 2] *= retain;
        } else {
          v[offset] *= 0.03;
          v[offset + 1] *= 0.03;
          if (v[offset + 2] < 0) v[offset + 2] = 0;
        }
      } else if (p[offset + 2] < world.hopperBottom) {
        v[offset] *= 0.42;
        v[offset + 1] *= 0.42;
      }
      if (!world.state.discharged[index] && p[offset + 2] < world.hopperBottom - radius) {
        world.state.discharged[index] = 1;
        world.state.dischargedAt[index] = world.time + dt;
      }
    }
    applyGrainRestitution(world, incoming);
    applyGrainFriction(world, incoming);
    for (let index = 0; index < world.count; index += 1) {
      const offset = index * 3;
      const radius = grainRadius(world, index);
      const baseDistance = world.baseTilt.degrees === 0 ? p[offset + 2]
        : (p[offset + 2] - world.baseTilt.slopeX * p[offset]
          - world.baseTilt.slopeY * p[offset + 1]) * world.baseTilt.inverseNormal;
      if (baseDistance <= radius * 1.04) {
        world.state.angularVelocities[offset] *= 1 - world.rollingResistance;
        world.state.angularVelocities[offset + 1] *= 1 - world.rollingResistance;
        world.state.angularVelocities[offset + 2] *= 1 - world.rollingResistance;
        const blend = world.friction * 0.055;
        world.state.angularVelocities[offset] += (-v[offset + 1] / radius
          - world.state.angularVelocities[offset]) * blend;
        world.state.angularVelocities[offset + 1] += (v[offset] / radius
          - world.state.angularVelocities[offset + 1]) * blend;
      }
    }
    integrateOrientations(world, dt);
    if (!world.archLocked && world.outletRadius / world.radius < 2.55 && world.time >= 0.12) {
      let throatCount = 0;
      for (let index = 0; index < world.count; index += 1) {
        const offset = index * 3;
        const radius = grainRadius(world, index);
        const radial = Math.hypot(p[offset], p[offset + 1]);
        if (!world.state.discharged[index]
            && p[offset + 2] < world.hopperBottom + world.diameter * 1.8
            && radial < world.outletRadius + radius) throatCount += 1;
      }
      world.archLocked = throatCount >= 3;
      if (world.archLocked) {
        world._archLastDischargedCount = world.state.discharged.reduce((sum, value) => sum + value, 0);
        world._archStableSteps = 0;
        world.flowDiagnostic = Object.freeze({
          status: 'arching',
          outletDiameterInMeanGrains: world.outletDiameterInMeanGrains,
          throatGrainCount: throatCount,
          lockedAtStep: Math.round(world.time / world.fixedStep),
          lockedAtTime: world.time,
          dischargedCount: world._archLastDischargedCount,
        });
      }
    }
    if (world.archLocked) {
      const dischargedCount = world.state.discharged.reduce((sum, value) => sum + value, 0);
      if (dischargedCount === world._archLastDischargedCount) world._archStableSteps += 1;
      else { world._archLastDischargedCount = dischargedCount; world._archStableSteps = 0; }
      if (world._archStableSteps >= 24 && world.flowDiagnostic.status !== 'no-flow-arch') {
        world.flowDiagnostic = Object.freeze({
          ...world.flowDiagnostic, status: 'no-flow-arch',
          confirmedAtStep: Math.round(world.time / world.fixedStep),
          confirmedAtTime: world.time,
          dischargedCount,
        });
      }
    }
    world.time += dt;
  }
  return world;
}

function stateHash(world) {
  let value = 0x811c9dc5;
  for (const view of [world.state.positions, world.state.velocities, world.state.orientations,
    world.state.angularVelocities, world.state.aspects, world.state.sizeScales]) {
    const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
    for (const byte of bytes) value = Math.imul(value ^ byte, 0x01000193) >>> 0;
  }
  return value.toString(16).padStart(8, '0');
}

function reposeAngle(world) {
  const p = world.state.positions;
  const samples = [];
  for (let index = 0; index < world.count; index += 1) {
    if (!world.state.discharged[index]) continue;
    const offset = index * 3;
    samples.push([Math.hypot(p[offset], p[offset + 1]), p[offset + 2] + grainRadius(world, index)]);
  }
  if (samples.length < 8) return 0;
  const binWidth = world.diameter * 0.75;
  const binCount = Math.max(4, Math.ceil(Math.max(...samples.map((sample) => sample[0])) / binWidth) + 1);
  const bins = Array.from({ length: binCount }, () => []);
  for (const [radius, height] of samples) bins[Math.min(binCount - 1, Math.floor(radius / binWidth))].push(height);
  const occupied = bins.map((values, index) => ({
    radius: (index + 0.5) * binWidth,
    count: values.length,
    surface: values.length ? Math.max(...values) : 0,
  })).filter((bin) => bin.count >= 4);
  const outerStart = occupied.at(-1).radius * 0.68;
  const slopes = [];
  for (let index = 1; index < occupied.length; index += 1) {
    const inner = occupied[index - 1]; const outer = occupied[index];
    if (inner.radius < outerStart || outer.surface >= inner.surface) continue;
    slopes.push(Math.atan2(inner.surface - outer.surface, outer.radius - inner.radius) * 180 / Math.PI);
  }
  if (!slopes.length) return 0;
  slopes.sort((a, b) => a - b);
  const middle = Math.floor(slopes.length / 2);
  return slopes.length % 2 ? slopes[middle] : (slopes[middle - 1] + slopes[middle]) * 0.5;
}

export function measureDrySandPileStabilityReference(world) {
  let grainCount = 0; let speedSquared = 0; let downslope = 0; let maximumHeight = 0;
  const directionX = -Math.cos(world.baseTilt.azimuthRadians);
  const directionY = -Math.sin(world.baseTilt.azimuthRadians);
  for (let index = 0; index < world.count; index += 1) {
    if (!world.state.discharged[index]) continue;
    const offset = index * 3;
    grainCount += 1;
    speedSquared += world.state.velocities[offset] ** 2
      + world.state.velocities[offset + 1] ** 2 + world.state.velocities[offset + 2] ** 2;
    downslope += world.state.positions[offset] * directionX
      + world.state.positions[offset + 1] * directionY;
    maximumHeight = Math.max(maximumHeight, world.state.positions[offset + 2] + grainRadius(world, index));
  }
  const activeCount = world.count - grainCount;
  return Object.freeze({
    grainCount, activeCount,
    massError: (world.count - activeCount - grainCount) / world.count,
    speedRms: Math.sqrt(speedSquared / Math.max(1, grainCount)),
    downslopeCentroid: downslope / Math.max(1, grainCount),
    maximumHeight,
    reposeAngleDegrees: reposeAngle(world),
  });
}

export function measureDrySandPileInteractionReference(world) {
  if (!world.receivingObstacle) throw new Error('receiving obstacle is not configured');
  const [cx, cy, cz] = world.receivingObstacle.center;
  const [rx, ry, rz] = world.receivingObstacle.radii;
  let grainCount = 0; let centroidX = 0; let meanRadialDistance = 0;
  let contactCount = 0; let minimumNormalizedClearance = Infinity;
  for (let index = 0; index < world.count; index += 1) {
    contactCount += world.state.obstacleContacted[index];
    if (!world.state.discharged[index]) continue;
    grainCount += 1;
    const offset = index * 3; const r = grainRadius(world, index);
    const x = world.state.positions[offset]; const y = world.state.positions[offset + 1];
    const z = world.state.positions[offset + 2];
    centroidX += x; meanRadialDistance += Math.hypot(x, y);
    minimumNormalizedClearance = Math.min(minimumNormalizedClearance, Math.hypot(
      (x - cx) / (rx + r), (y - cy) / (ry + r), (z - cz) / (rz + r),
    ));
  }
  const activeCount = world.count - grainCount;
  return Object.freeze({
    grainCount, activeCount, massError: (world.count - activeCount - grainCount) / world.count,
    contactCount, minimumNormalizedClearance,
    centroidX: centroidX / Math.max(1, grainCount),
    meanRadialDistance: meanRadialDistance / Math.max(1, grainCount),
  });
}

const TRIAL_CACHE = new Map();

export function runDrySandHopperTrialReference(options = {}) {
  const key = JSON.stringify(options);
  if (TRIAL_CACHE.has(key)) return TRIAL_CACHE.get(key);
  const world = createDrySandHopperReference(options);
  const duration = finitePositive(options.duration ?? 3, 'duration');
  stepDrySandHopperReference(world, Math.round(duration / world.fixedStep));
  let dischargedCount = 0; let speedSquared = 0; let settledCount = 0;
  const dischargeTimes = [];
  for (let index = 0; index < world.count; index += 1) {
    if (world.state.discharged[index]) {
      dischargedCount += 1;
      dischargeTimes.push(world.state.dischargedAt[index]);
    }
    const offset = index * 3;
    if (world.state.positions[offset + 2] < world.hopperBottom) {
      speedSquared += world.state.velocities[offset] ** 2
        + world.state.velocities[offset + 1] ** 2 + world.state.velocities[offset + 2] ** 2;
      settledCount += 1;
    }
  }
  const minimumAspectRatio = Math.min(...world.state.aspects);
  const maximumAspectRatio = Math.max(...world.state.aspects);
  const meanSizeScale = world.state.sizeScales.reduce((sum, value) => sum + value, 0) / world.count;
  dischargeTimes.sort((a, b) => a - b);
  const q1 = dischargeTimes[Math.floor(dischargeTimes.length * 0.25)] ?? 0;
  const q3 = dischargeTimes[Math.floor(dischargeTimes.length * 0.75)] ?? duration;
  const steadyCount = Math.max(0, Math.floor(dischargeTimes.length * 0.75)
    - Math.floor(dischargeTimes.length * 0.25));
  const result = Object.freeze({
    initialGrainCount: world.count,
    activeCount: world.count - dischargedCount,
    dischargedCount,
    massError: (world.count - (world.count - dischargedCount) - dischargedCount) / world.count,
    meanDischargeRate: steadyCount / Math.max(world.fixedStep, q3 - q1),
    maxPersistentPenetration: world.maxPersistentPenetration,
    meanGrainDiameter: world.diameter * meanSizeScale,
    reposeAngleDegrees: reposeAngle(world),
    settledSpeedRms: Math.sqrt(speedSquared / Math.max(1, settledCount)),
    clogged: world.archLocked,
    flowDiagnostic: world.flowDiagnostic,
    stateHash: stateHash(world), minimumAspectRatio, maximumAspectRatio,
    vectorBytes: world.state.positions.byteLength + world.state.velocities.byteLength
      + world.state.orientations.byteLength + world.state.angularVelocities.byteLength
      + world.state.aspects.byteLength + world.state.sizeScales.byteLength
      + world.state.discharged.byteLength,
    fixedStep: world.fixedStep, solverIterations: world.solverIterations,
    world,
  });
  TRIAL_CACHE.set(key, result);
  return result;
}

function sphereTemplate(latitudeSegments = 8, longitudeSegments = 12) {
  const row = longitudeSegments + 1;
  const vertices = new Float32Array((latitudeSegments + 1) * row * 10);
  let offset = 0;
  for (let latitude = 0; latitude <= latitudeSegments; latitude += 1) {
    const phi = latitude / latitudeSegments * Math.PI;
    for (let longitude = 0; longitude <= longitudeSegments; longitude += 1) {
      const theta = longitude / longitudeSegments * Math.PI * 2;
      const nx = Math.sin(phi) * Math.cos(theta);
      const ny = Math.sin(phi) * Math.sin(theta);
      const nz = Math.cos(phi);
      vertices.set([nx, ny, nz, nx, ny, nz, 1, 1, 1, 1], offset);
      offset += 10;
    }
  }
  const indices = new Uint32Array(latitudeSegments * longitudeSegments * 6);
  offset = 0;
  for (let latitude = 0; latitude < latitudeSegments; latitude += 1) {
    for (let longitude = 0; longitude < longitudeSegments; longitude += 1) {
      const a = latitude * row + longitude;
      const b = a + 1; const c = a + row; const d = c + 1;
      indices.set([a, c, b, b, c, d], offset); offset += 6;
    }
  }
  return { vertices, indices };
}

export function syncDrySandRenderPacketReference(world, packet) {
  const instances = packet.instances;
  for (let index = 0; index < world.count; index += 1) {
    const source = index * 3; const target = index * 8;
    instances[target] = world.state.positions[source];
    instances[target + 1] = world.state.positions[source + 1];
    instances[target + 2] = world.state.positions[source + 2];
    instances[target + 3] = world.state.aggregated[index] ? 0 : grainRadius(world, index) * (world.state.aspects[source]
      + world.state.aspects[source + 1] + world.state.aspects[source + 2]) / 3;
  }
  return packet;
}

export function createDrySandRenderPacketReference(world) {
  const template = sphereTemplate();
  const instances = new Float32Array(world.count * 8);
  for (let index = 0; index < world.count; index += 1) {
    const target = index * 8;
    const warm = unit(world.seed, index * 13);
    instances[target + 4] = 0.58 + warm * 0.16;
    instances[target + 5] = 0.42 + warm * 0.13;
    instances[target + 6] = 0.20 + warm * 0.08;
    instances[target + 7] = 1;
  }
  const packet = {
    type: 'field_mesh', id: 'sand:active-grains', object_id: 1, mode3d: true,
    topology: 'triangle-list', instance_kind: 'sphere-list', instance_count: world.count,
    transparent: false, depth_write: true, receives_lighting: true,
    casts_shadow: true, receives_shadow: false, specular_strength: 0.09,
    vertices: template.vertices, indices: template.indices, instances,
  };
  world.render.instances = instances;
  return syncDrySandRenderPacketReference(world, packet);
}

export function createDrySandObstacleRenderPacketReference(world, {
  latitudeSegments = 16, longitudeSegments = 24,
} = {}) {
  if (!world.receivingObstacle) throw new Error('receiving obstacle is not configured');
  const template = sphereTemplate(latitudeSegments, longitudeSegments);
  const vertices = template.vertices.slice();
  const [cx, cy, cz] = world.receivingObstacle.center;
  const [rx, ry, rz] = world.receivingObstacle.radii;
  for (let offset = 0; offset < vertices.length; offset += 10) {
    const dx = vertices[offset]; const dy = vertices[offset + 1]; const dz = vertices[offset + 2];
    vertices[offset] = cx + dx * rx; vertices[offset + 1] = cy + dy * ry;
    vertices[offset + 2] = cz + dz * rz;
    const nx = dx / rx; const ny = dy / ry; const nz = dz / rz;
    const inverse = 1 / Math.hypot(nx, ny, nz);
    vertices[offset + 3] = nx * inverse; vertices[offset + 4] = ny * inverse;
    vertices[offset + 5] = nz * inverse;
    vertices[offset + 6] = 0.29; vertices[offset + 7] = 0.31;
    vertices[offset + 8] = 0.32; vertices[offset + 9] = 1;
  }
  return Object.freeze({
    type: 'field_mesh', id: 'sand:receiving-ellipsoid', object_id: 6, mode3d: true,
    topology: 'triangle-list', static_vertices: true, static_indices: true,
    transparent: false, depth_write: true, receives_lighting: true,
    casts_shadow: true, receives_shadow: false, specular_strength: 0.18,
    vertices, indices: template.indices,
  });
}

function rotateByQuaternion(x, y, z, q, offset) {
  const qx = q[offset]; const qy = q[offset + 1]; const qz = q[offset + 2]; const qw = q[offset + 3];
  const tx = 2 * (qy * z - qz * y);
  const ty = 2 * (qz * x - qx * z);
  const tz = 2 * (qx * y - qy * x);
  return [x + qw * tx + qy * tz - qz * ty,
    y + qw * ty + qz * tx - qx * tz,
    z + qw * tz + qx * ty - qy * tx];
}

export function syncDrySandEllipsoidRenderPacketReference(world, packet) {
  const directions = packet._directions;
  const verticesPerGrain = directions.length / 3;
  for (let grain = 0; grain < world.count; grain += 1) {
    const source = grain * 3; const qo = grain * 4;
    const warm = unit(world.seed, grain * 13);
    const color = [0.58 + warm * 0.16, 0.42 + warm * 0.13, 0.20 + warm * 0.08];
    for (let vertex = 0; vertex < verticesPerGrain; vertex += 1) {
      const direction = vertex * 3; const target = (grain * verticesPerGrain + vertex) * 10;
      const dx = directions[direction]; const dy = directions[direction + 1]; const dz = directions[direction + 2];
      const ax = world.state.aspects[source]; const ay = world.state.aspects[source + 1]; const az = world.state.aspects[source + 2];
      const radius = grainRadius(world, grain);
      const local = [dx * radius * ax, dy * radius * ay, dz * radius * az];
      const rotated = rotateByQuaternion(...local, world.state.orientations, qo);
      const normalLocal = [dx / ax, dy / ay, dz / az];
      const inverse = 1 / Math.hypot(...normalLocal);
      const normal = rotateByQuaternion(normalLocal[0] * inverse, normalLocal[1] * inverse,
        normalLocal[2] * inverse, world.state.orientations, qo);
      packet.vertices.set([world.state.positions[source] + rotated[0],
        world.state.positions[source + 1] + rotated[1], world.state.positions[source + 2] + rotated[2],
        ...normal, ...color, 1], target);
    }
  }
  return packet;
}

export function createDrySandEllipsoidRenderPacketReference(world, {
  latitudeSegments = 6, longitudeSegments = 10,
} = {}) {
  const latitudes = Math.trunc(latitudeSegments); const longitudes = Math.trunc(longitudeSegments);
  if (latitudes < 4 || latitudes > 12 || longitudes < 6 || longitudes > 18) {
    throw new RangeError('sand ellipsoid tessellation is outside bounded detail');
  }
  const verticesPerGrain = (latitudes + 1) * (longitudes + 1);
  const directions = new Float32Array(verticesPerGrain * 3);
  let cursor = 0;
  for (let latitude = 0; latitude <= latitudes; latitude += 1) {
    const phi = latitude / latitudes * Math.PI;
    for (let longitude = 0; longitude <= longitudes; longitude += 1) {
      const theta = longitude / longitudes * Math.PI * 2;
      directions.set([Math.sin(phi) * Math.cos(theta), Math.sin(phi) * Math.sin(theta), Math.cos(phi)], cursor);
      cursor += 3;
    }
  }
  const indices = new Uint32Array(world.count * latitudes * longitudes * 6);
  cursor = 0;
  for (let grain = 0; grain < world.count; grain += 1) {
    const base = grain * verticesPerGrain; const row = longitudes + 1;
    for (let latitude = 0; latitude < latitudes; latitude += 1) for (let longitude = 0; longitude < longitudes; longitude += 1) {
      const a = base + latitude * row + longitude; const b = a + 1; const c = a + row; const d = c + 1;
      indices.set([a, c, b, b, c, d], cursor); cursor += 6;
    }
  }
  const packet = {
    type:'field_mesh', id:'sand:oriented-active-grains', object_id:1, mode3d:true,
    topology:'triangle-list', static_vertices:false, static_indices:true,
    transparent:false, depth_write:true, receives_lighting:true, casts_shadow:true,
    receives_shadow:false, specular_strength:0.09,
    vertices:new Float32Array(world.count * verticesPerGrain * 10), indices,
    sourcePositions:world.state.positions, sourceOrientations:world.state.orientations,
    sourceSizeScales:world.state.sizeScales,
    _directions:directions,
  };
  packet.vectorBytes = packet.vertices.byteLength + packet.indices.byteLength + directions.byteLength;
  world.render.ellipsoidVertices = packet.vertices;
  return syncDrySandEllipsoidRenderPacketReference(world, packet);
}

export function createDrySandHopperHardwarePacketsReference(world, { segments = 64 } = {}) {
  const count = Math.trunc(segments);
  if (!Number.isSafeInteger(count) || count < 24 || count > 128) {
    throw new RangeError('sand hopper hardware segments must be in 24..128');
  }
  const funnelVertices = new Float32Array((count + 1) * 2 * 10);
  const funnelIndices = new Uint32Array(count * 6);
  const slope = world.hopperRadius - world.outletRadius;
  const normalLength = Math.hypot(world.hopperTop - world.hopperBottom, slope);
  let vertexOffset = 0; let indexOffset = 0;
  for (let segment = 0; segment <= count; segment += 1) {
    const angle = segment / count * Math.PI * 2;
    const cosine = Math.cos(angle); const sine = Math.sin(angle);
    const nx = cosine * (world.hopperTop - world.hopperBottom) / normalLength;
    const ny = sine * (world.hopperTop - world.hopperBottom) / normalLength;
    const nz = -slope / normalLength;
    for (const [radius, z] of [[world.outletRadius, world.hopperBottom], [world.hopperRadius, world.hopperTop]]) {
      funnelVertices.set([radius*cosine,radius*sine,z,nx,ny,nz,.36,.39,.42,.31],vertexOffset);
      vertexOffset += 10;
    }
    if (segment < count) {
      const a=segment*2,b=a+1,c=a+2,d=a+3;
      funnelIndices.set([a,c,b,b,c,d],indexOffset); indexOffset += 6;
    }
  }
  const outerRadius = Math.max(world.outletRadius * 2.75, world.hopperRadius * 0.72);
  const plateVertices = new Float32Array((count + 1) * 2 * 10);
  const plateIndices = new Uint32Array(count * 6);
  vertexOffset=0; indexOffset=0;
  for (let segment=0;segment<=count;segment+=1) {
    const angle=segment/count*Math.PI*2; const cosine=Math.cos(angle); const sine=Math.sin(angle);
    for (const radius of [world.outletRadius,outerRadius]) {
      plateVertices.set([radius*cosine,radius*sine,world.hopperBottom,0,0,1,.28,.30,.32,.92],vertexOffset);
      vertexOffset+=10;
    }
    if (segment<count) {
      const a=segment*2,b=a+1,c=a+2,d=a+3;
      plateIndices.set([a,b,c,c,b,d],indexOffset); indexOffset+=6;
    }
  }
  const common = { type:'field_mesh',mode3d:true,topology:'triangle-list',static_vertices:true,
    static_indices:true,receives_lighting:true,casts_shadow:false,receives_shadow:false };
  return Object.freeze([
    Object.freeze({ ...common,id:'sand:circular-hopper',object_id:2,transparent:true,depth_write:false,
      specular_strength:.34,vertices:funnelVertices,indices:funnelIndices }),
    Object.freeze({ ...common,id:'sand:outlet-plate',object_id:5,transparent:false,depth_write:true,
      specular_strength:.26,vertices:plateVertices,indices:plateIndices }),
  ]);
}
