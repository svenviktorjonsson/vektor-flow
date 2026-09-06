const FIXED_STEP = 1 / 120;
const SOLVER_ITERATIONS = 4;
const GRAVITY = -9.82;

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

function initialGrains({ seed, grainCount, radius, fillHeightInGrains, hopperBottom, hopperTop, hopperRadius, outletRadius }) {
  const positions = new Float32Array(grainCount * 3);
  const velocities = new Float32Array(grainCount * 3);
  const orientations = new Float32Array(grainCount * 4);
  const angularVelocities = new Float32Array(grainCount * 3);
  const aspects = new Float32Array(grainCount * 3);
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
        const stretch = 0.78 + unit(seed, index * 7 + 4) * 0.44;
        aspects[offset] = stretch;
        aspects[offset + 1] = 0.88 + unit(seed, index * 7 + 5) * 0.20;
        aspects[offset + 2] = 0.88 + unit(seed, index * 7 + 6) * 0.20;
        index += 1;
        emitted = true;
      }
    }
    if (!emitted || cappedZ >= hopperTop - radius) {
      throw new RangeError('grain count exceeds bounded hopper fill capacity');
    }
  }
  return { positions, velocities, orientations, angularVelocities, aspects };
}

export function createDrySandHopperReference({
  seed = 0x5a17,
  grainCount = 384,
  grainDiameter = 0.052,
  outletDiameterInGrains = 4,
  fillHeightInGrains = 20,
} = {}) {
  const count = Math.trunc(finitePositive(grainCount, 'grainCount'));
  const diameter = finitePositive(grainDiameter, 'grainDiameter');
  const radius = diameter * 0.5;
  const hopperBottom = 0.72;
  const hopperTop = 2.45;
  const hopperRadius = 0.66;
  const outletRadius = diameter * finitePositive(outletDiameterInGrains, 'outletDiameterInGrains') * 0.5;
  const initial = initialGrains({
    seed: seed >>> 0, grainCount: count, radius, fillHeightInGrains,
    hopperBottom, hopperTop, hopperRadius, outletRadius,
  });
  const state = {
    positions: initial.positions.slice(),
    velocities: initial.velocities.slice(),
    orientations: initial.orientations.slice(),
    angularVelocities: initial.angularVelocities.slice(),
    aspects: initial.aspects.slice(),
    discharged: new Uint8Array(count),
    dischargedAt: new Float32Array(count).fill(-1),
  };
  return {
    kind: 'dry-sand-hopper-reference:v1', seed: seed >>> 0, count,
    radius, diameter, hopperBottom, hopperTop, hopperRadius, outletRadius,
    fixedStep: FIXED_STEP, solverIterations: SOLVER_ITERATIONS, time: 0,
    friction: 0.58, rollingResistance: 0.12, restitution: 0.04,
    state,
    render: { positions: state.positions, orientations: state.orientations, aspects: state.aspects },
    initial: Object.freeze({
      positions: initial.positions, velocities: initial.velocities,
      orientations: initial.orientations, angularVelocities: initial.angularVelocities,
      aspects: initial.aspects,
    }),
    maxPersistentPenetration: 0,
    archLocked: false,
  };
}

export function resetDrySandHopperReference(world) {
  world.state.positions.set(world.initial.positions);
  world.state.velocities.set(world.initial.velocities);
  world.state.orientations.set(world.initial.orientations);
  world.state.angularVelocities.set(world.initial.angularVelocities);
  world.state.aspects.set(world.initial.aspects);
  world.state.discharged.fill(0);
  world.state.dischargedAt.fill(-1);
  world.time = 0;
  world.maxPersistentPenetration = 0;
  world.archLocked = false;
  return world;
}

function projectBoundaries(world, previous) {
  const p = world.state.positions;
  const v = world.state.velocities;
  const r = world.radius;
  let maxPenetration = 0;
  for (let index = 0; index < world.count; index += 1) {
    const offset = index * 3;
    let x = p[offset]; let y = p[offset + 1]; let z = p[offset + 2];
    if (z < r) {
      maxPenetration = Math.max(maxPenetration, r - z);
      z = r;
      const slip = Math.max(0, 1 - world.friction * 0.15);
      v[offset] *= slip; v[offset + 1] *= slip;
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
      if (z < world.hopperBottom + r && wasAbove && plateBlocks) {
        maxPenetration = Math.max(maxPenetration, world.hopperBottom + r - z);
        z = world.hopperBottom + r;
      }
      if (!world.state.discharged[index] && z < world.hopperBottom + world.diameter * 4) {
        const effectiveOpening = Math.max(world.radius, world.outletRadius - world.radius * 1.5);
        const terminalSpeed = Math.sqrt(Math.abs(GRAVITY) * effectiveOpening) * 0.72;
        z = Math.max(z, previous[offset + 2] - terminalSpeed * world.fixedStep);
      }
    }
    p[offset] = x; p[offset + 1] = y; p[offset + 2] = z;
  }
  return maxPenetration;
}

function applyGrainFriction(world) {
  const p = world.state.positions;
  const v = world.state.velocities;
  const inverse = 1 / world.diameter;
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
        if (distance > world.diameter * 1.025 || distance < 1e-9) continue;
        const nx = nx0 / distance; const ny = ny0 / distance; const nz = nz0 / distance;
        const rvx = v[offset] - v[oo];
        const rvy = v[offset + 1] - v[oo + 1];
        const rvz = v[offset + 2] - v[oo + 2];
        const normalSpeed = rvx * nx + rvy * ny + rvz * nz;
        const tx = rvx - normalSpeed * nx;
        const ty = rvy - normalSpeed * ny;
        const tz = rvz - normalSpeed * nz;
        const scale = Math.min(0.49, world.friction * 0.82);
        v[offset] -= tx * scale; v[offset + 1] -= ty * scale; v[offset + 2] -= tz * scale;
        v[oo] += tx * scale; v[oo + 1] += ty * scale; v[oo + 2] += tz * scale;
      }
    }
    const key = `${cx}:${cy}:${cz}`;
    const bucket = cells.get(key);
    if (bucket) bucket.push(index); else cells.set(key, [index]);
  }
}

function remainingPenetration(world) {
  const p = world.state.positions;
  const inverse = 1 / world.diameter;
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
        maximum = Math.max(maximum, world.diameter - Math.hypot(
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
  const diameter = world.diameter;
  const inverse = 1 / diameter;
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
        if (distance >= diameter) continue;
        if (distance < 1e-9) {
          const angle = unit(world.seed, index * 4099 + other) * Math.PI * 2;
          nx = Math.cos(angle); ny = Math.sin(angle); nz = 0; distance = 1;
        } else { nx /= distance; ny /= distance; nz /= distance; }
        const penetration = diameter - distance;
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
  for (let step = 0; step < count; step += 1) {
    previous.set(p);
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
      v[offset] = (p[offset] - previous[offset]) / dt * 0.985;
      v[offset + 1] = (p[offset + 1] - previous[offset + 1]) / dt * 0.985;
      v[offset + 2] = (p[offset + 2] - previous[offset + 2]) / dt * 0.992;
      if (p[offset + 2] <= world.radius * 1.02) {
        v[offset] *= 0.03;
        v[offset + 1] *= 0.03;
        if (v[offset + 2] < 0) v[offset + 2] = 0;
      } else if (p[offset + 2] < world.hopperBottom) {
        v[offset] *= 0.42;
        v[offset + 1] *= 0.42;
      }
      world.state.angularVelocities[offset] *= 1 - world.rollingResistance;
      world.state.angularVelocities[offset + 1] *= 1 - world.rollingResistance;
      world.state.angularVelocities[offset + 2] *= 1 - world.rollingResistance;
      if (!world.state.discharged[index] && p[offset + 2] < world.hopperBottom - world.radius) {
        world.state.discharged[index] = 1;
        world.state.dischargedAt[index] = world.time + dt;
      }
    }
    applyGrainFriction(world);
    if (!world.archLocked && world.outletRadius / world.radius < 2.55 && world.time >= 0.12) {
      let throatCount = 0;
      for (let index = 0; index < world.count; index += 1) {
        const offset = index * 3;
        const radial = Math.hypot(p[offset], p[offset + 1]);
        if (!world.state.discharged[index]
            && p[offset + 2] < world.hopperBottom + world.diameter * 1.8
            && radial < world.outletRadius + world.radius) throatCount += 1;
      }
      world.archLocked = throatCount >= 3;
    }
    world.time += dt;
  }
  return world;
}

function stateHash(world) {
  let value = 0x811c9dc5;
  for (const view of [world.state.positions, world.state.velocities, world.state.orientations]) {
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
    samples.push([Math.hypot(p[offset], p[offset + 1]), p[offset + 2] + world.radius]);
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
    meanGrainDiameter: world.diameter,
    reposeAngleDegrees: reposeAngle(world),
    settledSpeedRms: Math.sqrt(speedSquared / Math.max(1, settledCount)),
    clogged: world.archLocked,
    stateHash: stateHash(world), minimumAspectRatio, maximumAspectRatio,
    vectorBytes: world.state.positions.byteLength + world.state.velocities.byteLength
      + world.state.orientations.byteLength + world.state.angularVelocities.byteLength
      + world.state.aspects.byteLength + world.state.discharged.byteLength,
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
    instances[target + 3] = world.radius * (world.state.aspects[source]
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
