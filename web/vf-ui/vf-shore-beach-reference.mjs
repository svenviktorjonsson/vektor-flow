import { createConditionedRoot } from './vf-conditioned-distribution.mjs';
import { sampleSpatialCorrelation2Reference } from './vf-spatial-correlation.mjs';
import { createStoneSpeciesPileReference } from './vf-stone-species-pile.mjs';

function hashBytes(views, scalars = []) {
  let value = 0x811c9dc5;
  for (const view of views) {
    const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
    for (const byte of bytes) value = Math.imul(value ^ byte, 0x01000193) >>> 0;
  }
  const scalarBytes = new Uint8Array(new Float64Array(scalars).buffer);
  for (const byte of scalarBytes) value = Math.imul(value ^ byte, 0x01000193) >>> 0;
  return value.toString(16).padStart(8, '0');
}

function requireResolution(value) {
  const result = Math.trunc(Number(value));
  if (!Number.isSafeInteger(result) || result < 17 || result > 129 || result % 2 !== 1) {
    throw new RangeError('shore resolution must be an odd integer in 17..129');
  }
  return result;
}

function terrainNode(seed) {
  return createConditionedRoot({
    generator: 'vkf.conditioned', version: 1, seed: [seed >>> 0, (seed ^ 0x9e3779b9) >>> 0],
    domain: 'material', hierarchy: ['world:shore-beach'], lod: 0, channel: 'terrain:height',
  });
}

function fieldHeight(node, x, y) {
  const broad = sampleSpatialCorrelation2Reference(node, [x, y], {
    correlationLength: 1.15, mean: 0, amplitude: 0.18,
  });
  const detail = sampleSpatialCorrelation2Reference(node, [x + 13.25, y - 7.5], {
    correlationLength: 0.38, mean: 0, amplitude: 0.035,
  });
  return x * 0.20 + broad + detail;
}

function intersection(a, b, waterLevel) {
  const t = (waterLevel - a[2]) / (b[2] - a[2]);
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, waterLevel];
}

function extractWaterline(samples, resolution, waterLevel) {
  const segments = [];
  const point = index => [samples[index].x, samples[index].y, samples[index].height];
  for (let y = 0; y < resolution - 1; y += 1) for (let x = 0; x < resolution - 1; x += 1) {
    const a = y * resolution + x;
    for (const triangle of [[a, a + 1, a + resolution], [a + 1, a + resolution + 1, a + resolution]]) {
      const crossings = [];
      for (let edge = 0; edge < 3; edge += 1) {
        const first = point(triangle[edge]); const second = point(triangle[(edge + 1) % 3]);
        if ((first[2] <= waterLevel) !== (second[2] <= waterLevel)) {
          crossings.push(intersection(first, second, waterLevel));
        }
      }
      if (crossings.length === 2) segments.push(Object.freeze(crossings.map(Object.freeze)));
    }
  }
  return Object.freeze(segments);
}

function gridPacket(shore, id, color, height, alpha = 1) {
  const n = shore.resolution;
  const vertices = new Float32Array(n * n * 10);
  for (let y = 0; y < n; y += 1) for (let x = 0; x < n; x += 1) {
    const index = y * n + x; const sample = shore.samples[index];
    const left = shore.samples[y * n + Math.max(0, x - 1)].height;
    const right = shore.samples[y * n + Math.min(n - 1, x + 1)].height;
    const down = shore.samples[Math.max(0, y - 1) * n + x].height;
    const up = shore.samples[Math.min(n - 1, y + 1) * n + x].height;
    const nx = -(right - left) / (2 * shore.cellSize);
    const ny = -(up - down) / (2 * shore.cellSize);
    const inverse = 1 / Math.hypot(nx, ny, 1);
    const wet = sample.classification === 'wet' ? 0.78 : 1;
    const coverage = id === 'shore:sediment' ? Math.min(1, sample.sedimentDepth / 0.035) : alpha;
    vertices.set([sample.x, sample.y, height(sample), nx * inverse, ny * inverse, inverse,
      color[0] * wet, color[1] * wet, color[2] * wet, coverage], index * 10);
  }
  const values = [];
  for (let y = 0; y < n - 1; y += 1) for (let x = 0; x < n - 1; x += 1) {
    const a = y * n + x; values.push(a, a + 1, a + n, a + 1, a + n + 1, a + n);
  }
  return Object.freeze({
    type: 'field_mesh', id, object_id: id === 'shore:terrain' ? 301 : 302, mode3d: true,
    topology: 'triangle-list', static_vertices: true, static_indices: true,
    transparent: id === 'shore:sediment', depth_write: id !== 'shore:sediment',
    receives_lighting: true, casts_shadow: false, receives_shadow: true,
    specular_strength: id === 'shore:sediment' ? 0.08 : 0.03,
    sourceRevision: shore.revision, vertices, indices: new Uint32Array(values),
  });
}

export function createShoreBeachReference({
  seed = 0x5eac, resolution = 65, extent = 3.2, waterLevel = 0, wetWidth = 0.16,
} = {}) {
  const n = requireResolution(resolution);
  if (![extent, waterLevel, wetWidth].every(Number.isFinite) || extent <= 1 || wetWidth <= 0) {
    throw new RangeError('shore dimensions and water level must be finite and bounded');
  }
  const node = terrainNode(seed); const cellSize = extent * 2 / (n - 1);
  const heights = new Float64Array(n * n); const samples = [];
  const heightAt = (x, y) => fieldHeight(node, x, y);
  for (let y = 0; y < n; y += 1) for (let x = 0; x < n; x += 1) {
    const px = -extent + x * cellSize; const py = -extent + y * cellSize;
    const height = heightAt(px, py); const signedHeight = height - waterLevel;
    const classification = signedHeight <= 0 ? 'submerged' : (signedHeight <= wetWidth ? 'wet' : 'dry');
    const sedimentDepth = signedHeight <= 0 ? 0 : 0.012 + 0.035 * Math.exp(-signedHeight / 0.65);
    heights[y * n + x] = height;
    samples.push(Object.freeze({ x: px, y: py, height, signedHeight, classification, sedimentDepth }));
  }
  const revision = hashBytes([heights], [waterLevel, wetWidth]);
  const waterlineSegments = extractWaterline(samples, n, waterLevel);
  const sourcePile = createStoneSpeciesPileReference(); const rocks = [];
  for (let index = 0; index < 10; index += 1) {
    const sourceIndex = index; const source = sourcePile.individuals[sourceIndex];
    const y = -2.55 + index * (5.1 / 9);
    let x = 0;
    for (let step = 0; step < 18; step += 1) {
      const signed = heightAt(x, y) - waterLevel;
      x -= (signed - (0.26 + (index % 3) * 0.055)) / 0.20;
      x = Math.max(-extent + 0.35, Math.min(extent - 0.35, x));
    }
    const supportHeight = heightAt(x, y);
    rocks.push(Object.freeze({
      index, speciesIndex: source.speciesIndex, sourceIndex, x, y, supportHeight,
      supportGap: 0, clearance: supportHeight - waterLevel,
    }));
  }
  const vectorBytes = heights.byteLength + samples.length * 48
    + sourcePile.meshes.slice(0, 10).reduce((sum, packet) => sum + packet.vertices.byteLength + packet.indices.byteLength, 0);
  const shore = {
    kind: 'shore-beach-reference:v1', seed, resolution: n, extent, cellSize, waterLevel, wetWidth,
    heights, samples: Object.freeze(samples), waterlineSegments, rocks: Object.freeze(rocks), revision,
    heightAt,
    metrics: Object.freeze({ vectorBytes, minimumRockClearance: Math.min(...rocks.map(rock => rock.clearance)),
      maximumRockSupportGap: Math.max(...rocks.map(rock => rock.supportGap)) }),
    _sourcePile: sourcePile,
  };
  return Object.freeze(shore);
}

export function createShoreBeachRenderPacketsReference(shore) {
  const terrain = gridPacket(shore, 'shore:terrain', [0.23, 0.25, 0.20], sample => sample.height);
  const sediment = gridPacket(shore, 'shore:sediment', [0.66, 0.52, 0.31],
    sample => sample.height + sample.sedimentDepth + 0.002, 0);
  const e = shore.extent; const z = shore.waterLevel + 0.004;
  const water = Object.freeze({
    type: 'field_mesh', id: 'shore:water', object_id: 303, mode3d: true,
    topology: 'triangle-list', static_vertices: true, static_indices: true,
    transparent: true, depth_write: false, receives_lighting: true, casts_shadow: false, receives_shadow: false,
    specular_strength: 0.68, sourceRevision: shore.revision,
    vertices: new Float32Array([-e,-e,z,0,0,1,.06,.24,.34,.66, e,-e,z,0,0,1,.06,.24,.34,.66,
      e,e,z,0,0,1,.06,.24,.34,.66, -e,e,z,0,0,1,.06,.24,.34,.66]),
    indices: new Uint32Array([0,1,2,0,2,3]),
  });
  const rocks = shore.rocks.map((rock, index) => {
    const source = shore._sourcePile.meshes[rock.sourceIndex];
    const matrix = source._modelMatrix.slice();
    matrix[12] = rock.x; matrix[13] = rock.y;
    matrix[14] = rock.supportHeight + shore._sourcePile.individuals[rock.sourceIndex].center[2];
    return Object.freeze({ ...source, id: `shore:rock:${index}`, object_id: 320 + index,
      sourceRevision: shore.revision, _modelMatrix: matrix });
  });
  return Object.freeze({ terrain, sediment, water, rocks: Object.freeze(rocks) });
}
