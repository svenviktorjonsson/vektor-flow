import { stepDrySandHopperReference } from './vf-sand-hopper-reference.mjs';

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

function hashNumbers(values) {
  const bytes = new Uint8Array(values.buffer, values.byteOffset, values.byteLength);
  let hash = 0x811c9dc5;
  for (const byte of bytes) hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
  return hash.toString(16).padStart(8, '0');
}

function requireResolution(value) {
  const resolution = Math.trunc(Number(value));
  if (!Number.isSafeInteger(resolution) || resolution < 9 || resolution > 129 || resolution % 2 !== 1) {
    throw new RangeError('sand aggregate resolution must be an odd integer in 9..129');
  }
  return resolution;
}

function updateMetrics(aggregate) {
  let maximumSlope = 0;
  let heightSum = 0;
  const n = aggregate.resolution;
  for (let y = 0; y < n; y += 1) {
    for (let x = 0; x < n; x += 1) {
      const index = y * n + x;
      heightSum += aggregate.heights[index];
      if (x + 1 < n) maximumSlope = Math.max(maximumSlope,
        Math.abs(aggregate.heights[index] - aggregate.heights[index + 1]) / aggregate.cellSize);
      if (y + 1 < n) maximumSlope = Math.max(maximumSlope,
        Math.abs(aggregate.heights[index] - aggregate.heights[index + n]) / aggregate.cellSize);
    }
  }
  aggregate.maximumSlopeDegrees = Math.atan(maximumSlope) * 180 / Math.PI;
  aggregate.totalMass = heightSum * aggregate.cellSize ** 2 * aggregate.density;
  aggregate.heightHash = hashNumbers(aggregate.heights);
  aggregate.revision += 1;
}

export function createDrySandAggregateReference(world, {
  resolution = 33,
  extent = 1.4,
  density = 1_580,
  reposeAngleDegrees = 31,
} = {}) {
  const size = requireResolution(resolution);
  const boundedExtent = Number(extent);
  if (!Number.isFinite(boundedExtent) || boundedExtent <= world.diameter * 2) {
    throw new RangeError('sand aggregate extent must contain multiple grains');
  }
  const grainVolume = 4 / 3 * Math.PI * world.radius ** 3;
  const aggregate = {
    kind: 'dry-sand-aggregate:v1', seed: world.seed, resolution: size,
    extent: boundedExtent, cellSize: boundedExtent * 2 / (size - 1), density,
    reposeAngleDegrees, grainVolume, grainMass: grainVolume * density,
    heights: new Float64Array(size * size),
    rollingMass: new Float64Array(size * size),
    glint: new Float32Array(size * size),
    grainEquivalentCount: 0, totalMass: 0, maximumSlopeDegrees: 0,
    heightHash: '', revision: 0, fixedStep: 1 / 120,
  };
  for (let index = 0; index < aggregate.glint.length; index += 1) {
    const sparse = unit(world.seed ^ 0x6c8e9cf5, index);
    aggregate.glint[index] = sparse > 0.86 ? (sparse - 0.86) / 0.14 : unit(world.seed, index + 8192) * 0.08;
  }
  updateMetrics(aggregate);
  world.render.aggregate = aggregate;
  return aggregate;
}

function depositVolume(aggregate, x, y, volume) {
  const n = aggregate.resolution;
  const gx = Math.max(0, Math.min(n - 1, (x + aggregate.extent) / aggregate.cellSize));
  const gy = Math.max(0, Math.min(n - 1, (y + aggregate.extent) / aggregate.cellSize));
  const centerX = Math.round(gx); const centerY = Math.round(gy);
  const samples = []; let weightSum = 0;
  for (let dy = -2; dy <= 2; dy += 1) for (let dx = -2; dx <= 2; dx += 1) {
    const sx = centerX + dx; const sy = centerY + dy;
    if (sx < 0 || sx >= n || sy < 0 || sy >= n) continue;
    const distanceSquared = (sx - gx) ** 2 + (sy - gy) ** 2;
    const weight = Math.exp(-distanceSquared / 1.35);
    samples.push([sy * n + sx, weight]); weightSum += weight;
  }
  const height = volume / (aggregate.cellSize * aggregate.cellSize);
  for (const [index, weight] of samples) aggregate.heights[index] += height * weight / weightSum;
}

export function settleDrySandIntoAggregateReference(world, aggregate, { speedThreshold = 0.08 } = {}) {
  let transferredCount = 0;
  for (let index = 0; index < world.count; index += 1) {
    if (world.state.aggregated[index] || !world.state.discharged[index]) continue;
    const offset = index * 3;
    const speed = Math.hypot(
      world.state.velocities[offset], world.state.velocities[offset + 1], world.state.velocities[offset + 2],
    );
    if (speed > speedThreshold || world.state.positions[offset + 2] > world.diameter * 2.25) continue;
    depositVolume(aggregate, world.state.positions[offset], world.state.positions[offset + 1],
      aggregate.grainVolume);
    world.state.aggregated[index] = 1;
    transferredCount += 1;
  }
  aggregate.grainEquivalentCount += transferredCount;
  updateMetrics(aggregate);
  return Object.freeze({ transferredCount, explicitCount: world.count - aggregate.grainEquivalentCount });
}

export function stepDrySandBcreReference(aggregate, steps = 1) {
  const count = Math.max(0, Math.trunc(steps));
  const n = aggregate.resolution;
  const allowedDifference = Math.tan(aggregate.reposeAngleDegrees * Math.PI / 180) * aggregate.cellSize;
  const delta = new Float64Array(aggregate.heights.length);
  for (let step = 0; step < count; step += 1) {
    delta.fill(0);
    for (let y = 0; y < n; y += 1) {
      for (let x = 0; x < n; x += 1) {
        const index = y * n + x;
        for (const neighbor of [x + 1 < n ? index + 1 : -1, y + 1 < n ? index + n : -1]) {
          if (neighbor < 0) continue;
          const difference = aggregate.heights[index] - aggregate.heights[neighbor];
          const excess = Math.abs(difference) - allowedDifference;
          if (excess <= 0) continue;
          const transfer = Math.min(excess * 0.24, Math.max(0,
            (difference > 0 ? aggregate.heights[index] : aggregate.heights[neighbor]) * 0.22));
          if (difference > 0) { delta[index] -= transfer; delta[neighbor] += transfer; }
          else { delta[index] += transfer; delta[neighbor] -= transfer; }
        }
      }
    }
    for (let index = 0; index < aggregate.heights.length; index += 1) {
      aggregate.heights[index] = Math.max(0, aggregate.heights[index] + delta[index]);
      aggregate.rollingMass[index] = Math.abs(delta[index]) * aggregate.cellSize ** 2 * aggregate.density;
    }
  }
  updateMetrics(aggregate);
  return aggregate;
}

export function stepDrySandPourAggregateReference(world, aggregate, {
  steps = 1,
  speedThreshold = 0.08,
} = {}) {
  const count = Math.max(0, Math.trunc(steps));
  let transferredCount = 0; let maximumCountError = 0; let maximumMassError = 0;
  for (let step = 0; step < count; step += 1) {
    stepDrySandHopperReference(world, 1);
    const transfer = settleDrySandIntoAggregateReference(world, aggregate, { speedThreshold });
    transferredCount += transfer.transferredCount;
    stepDrySandBcreReference(aggregate, 1);
    const denseGrainCount = aggregate.grainEquivalentCount;
    const explicitCount = world.count - denseGrainCount;
    maximumCountError = Math.max(maximumCountError,
      Math.abs(world.count - explicitCount - denseGrainCount));
    maximumMassError = Math.max(maximumMassError,
      Math.abs(aggregate.totalMass - denseGrainCount * aggregate.grainMass));
  }
  return Object.freeze({
    steps: count,
    transferredCount,
    explicitCount: world.count - aggregate.grainEquivalentCount,
    denseGrainCount: aggregate.grainEquivalentCount,
    maximumCountError,
    maximumMassError,
    maximumSlopeDegrees: aggregate.maximumSlopeDegrees,
    heightHash: aggregate.heightHash,
  });
}

function normalAt(aggregate, x, y, step) {
  const n = aggregate.resolution;
  const left = aggregate.heights[y * n + Math.max(0, x - step)];
  const right = aggregate.heights[y * n + Math.min(n - 1, x + step)];
  const down = aggregate.heights[Math.max(0, y - step) * n + x];
  const up = aggregate.heights[Math.min(n - 1, y + step) * n + x];
  const span = aggregate.cellSize * step * 2;
  const nx = -(right - left) / span; const ny = -(up - down) / span;
  const inverse = 1 / Math.hypot(nx, ny, 1);
  return [nx * inverse, ny * inverse, inverse];
}

export function createDrySandAggregateRenderPacketReference(aggregate, { distance = 2 } = {}) {
  const lod = distance < 6 ? 'near' : (distance < 18 ? 'mid' : 'far');
  const step = lod === 'near' ? 1 : (lod === 'mid' ? 2 : 4);
  const grid = [];
  for (let value = 0; value < aggregate.resolution - 1; value += step) grid.push(value);
  grid.push(aggregate.resolution - 1);
  const width = grid.length;
  const vertices = new Float32Array(width * width * 10);
  let offset = 0;
  for (const y of grid) {
    for (const x of grid) {
      const index = y * aggregate.resolution + x;
      const normal = normalAt(aggregate, x, y, step);
      const glint = aggregate.glint[index];
      const tone = 0.48 + glint * 0.18;
      const coverage = Math.max(0, Math.min(1,
        aggregate.heights[index] / (aggregate.cellSize * 0.045),
      ));
      vertices.set([
        -aggregate.extent + x * aggregate.cellSize,
        -aggregate.extent + y * aggregate.cellSize,
        aggregate.heights[index],
        ...normal,
        tone, tone * 0.78, tone * 0.48, coverage,
      ], offset);
      offset += 10;
    }
  }
  const indexValues = [];
  for (let y = 0; y < width - 1; y += 1) for (let x = 0; x < width - 1; x += 1) {
    const a = y * width + x; const b = a + 1; const c = a + width; const d = c + 1;
    indexValues.push(a, b, c, b, d, c);
  }
  const indices = new Uint32Array(indexValues);
  return {
    type: 'field_mesh', id: `sand:aggregate:${lod}`, object_id: 4, mode3d: true,
    topology: 'triangle-list', static_vertices: false, static_indices: true,
    transparent: true, depth_write: false,
    receives_lighting: true, casts_shadow: false, receives_shadow: false,
    specular_strength: 0.12, lod, sourceRevision: aggregate.heightHash,
    vertices, indices,
    sand_aggregate_gpu: Object.freeze({
      kind: 'sand-aggregate-material:v1', heightHash: aggregate.heightHash,
      normalStrength: 0.42, roughness: 0.82, glintDensity: 0.14,
    }),
  };
}
