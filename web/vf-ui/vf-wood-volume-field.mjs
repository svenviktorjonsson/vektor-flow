import {
  conditionChild,
  createConditionedRoot,
  sampleBoundedUniform,
} from './vf-conditioned-distribution.mjs';
import {
  sampleSpatialCorrelation2Reference,
} from './vf-spatial-correlation.mjs';

const fieldState = new WeakMap();
const MAX_TREE_FIELDS = 4096;
const MAX_SAMPLES = 4096;
const SCALE_WAVELENGTHS = Object.freeze([0.25, 0.08, 0.02]);
const floatBitsBuffer = new ArrayBuffer(8);
const floatBitsView = new DataView(floatBitsBuffer);

function clampUnit(value) {
  return Math.max(0, Math.min(1, value));
}

function requireCoordinates(coordinates) {
  if (
    !coordinates
    || coordinates.kind !== 'wood-growth-coordinate-working-set:v1'
    || !Array.isArray(coordinates.primitiveIds)
    || !Array.isArray(coordinates.segments)
    || coordinates.primitiveIds.length !== coordinates.segmentCount
    || coordinates.segments.length !== coordinates.segmentCount
  ) {
    throw new TypeError('wood growth coordinate working set is required');
  }
}

function requirePoint(point) {
  const typed = ArrayBuffer.isView(point) && !(point instanceof DataView);
  if ((!Array.isArray(point) && !typed) || point.length !== 3) {
    throw new TypeError('wood volume point must contain exactly three numbers');
  }
  for (let component = 0; component < 3; component += 1) {
    if (typeof point[component] !== 'number' || !Number.isFinite(point[component])) {
      throw new RangeError(`wood volume point[${component}] must be finite`);
    }
  }
}

function requireOptions(detailLevel, footprint) {
  if (!Number.isSafeInteger(detailLevel) || detailLevel < 0) {
    throw new RangeError('wood volume detailLevel must be a non-negative safe integer');
  }
  if (typeof footprint !== 'number' || !Number.isFinite(footprint) || footprint < 0) {
    throw new RangeError('wood volume footprint must be finite and non-negative');
  }
}

function dot(left, right) {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

function float64Key(value) {
  floatBitsView.setFloat64(0, value, true);
  return `${floatBitsView.getUint32(4, true).toString(16)}:${floatBitsView.getUint32(0, true).toString(16)}`;
}

function filterWeight(wavelength, footprint) {
  if (footprint <= wavelength * 0.5) return 1;
  if (footprint >= wavelength) return 0;
  const ratio = (wavelength - footprint) / (wavelength * 0.5);
  return ratio * ratio * (3 - 2 * ratio);
}

function treeIdFromPrimitive(primitiveId) {
  if (primitiveId.endsWith(':trunk')) return primitiveId.slice(0, -6);
  const branch = primitiveId.lastIndexOf(':branch:');
  if (branch >= 0) return primitiveId.slice(0, branch);
  throw new RangeError('wood volume primitive must be a trunk or branch');
}

function treeField(state, primitiveId) {
  const treeId = treeIdFromPrimitive(primitiveId);
  const cached = state.treeFields.get(treeId);
  if (cached) {
    state.treeFields.delete(treeId);
    state.treeFields.set(treeId, cached);
    return cached;
  }
  const treeNode = conditionChild(state.root, {
    segment: `wood:${treeId}`,
    channel: 'wood-volume',
  });
  const value = Object.freeze({
    ringNode: conditionChild(treeNode, {
      segment: 'rings',
      channel: 'wood-rings',
    }),
    rayNode: conditionChild(treeNode, {
      segment: 'rays',
      channel: 'wood-rays',
    }),
    fiberNode: conditionChild(treeNode, {
      segment: 'fibers',
      channel: 'wood-fibers',
    }),
    ringSpacing: sampleBoundedUniform(treeNode, [0, 0], { min: 0.16, max: 0.34 }),
    rayCount: Math.floor(sampleBoundedUniform(treeNode, [0, 1], { min: 8, max: 17 })),
  });
  state.treeFields.set(treeId, value);
  if (state.treeFields.size > MAX_TREE_FIELDS) {
    state.treeFields.delete(state.treeFields.keys().next().value);
  }
  return value;
}

function growthPosition(segment, point) {
  const relative = point.map((value, component) => value - segment.origin[component]);
  return [
    dot(relative, segment.radialU),
    dot(relative, segment.radialV),
    segment.pathOffset + dot(relative, segment.axis),
  ];
}

function sampleKey(primitiveId, point, detailLevel, footprint) {
  return `${primitiveId}/${point.map(float64Key).join('/')}/${detailLevel}/${float64Key(footprint)}`;
}

function volumeSample(tree, primitiveId, position, detailLevel, footprint) {
  const [u, v, path] = position;
  const radial = Math.hypot(u, v);
  const angle = Math.atan2(v, u);
  const weights = SCALE_WAVELENGTHS.map((wavelength, scale) => (
    detailLevel >= scale ? filterWeight(wavelength, footprint) : 0
  ));
  const ringWarp = weights[0] > 0
    ? weights[0] * sampleSpatialCorrelation2Reference(
      tree.ringNode,
      [path, radial],
      { correlationLength: 1.5, mean: 0, amplitude: 0.08 },
    )
    : 0;
  const ring = 0.5 + 0.5 * weights[0] * Math.cos(
    2 * Math.PI * (radial / tree.ringSpacing + ringWarp),
  );
  const rayVariation = weights[1] > 0
    ? sampleSpatialCorrelation2Reference(
      tree.rayNode,
      [path, radial],
      { correlationLength: 0.3, mean: 0, amplitude: 0.12 },
    )
    : 0;
  const ray = weights[1] * (
    Math.abs(Math.cos(tree.rayCount * angle + rayVariation)) ** 12
  );
  const fiberNoise = weights[2] > 0
    ? sampleSpatialCorrelation2Reference(
      tree.fiberNode,
      [path + u * 0.31, v],
      { correlationLength: SCALE_WAVELENGTHS[2], mean: 0, amplitude: 1 },
    )
    : 0;
  const fiber = 0.5 + 0.5 * weights[2] * fiberNoise;
  const latewood = clampUnit(1 - ring);
  const density = clampUnit(0.38 + 0.34 * latewood + 0.08 * ray + 0.04 * fiber);
  const baseColor = Object.freeze([
    clampUnit(0.46 + 0.22 * ring + 0.08 * ray + 0.025 * fiber),
    clampUnit(0.25 + 0.17 * ring + 0.055 * ray + 0.018 * fiber),
    clampUnit(0.105 + 0.085 * ring + 0.035 * ray + 0.012 * fiber),
    1,
  ]);
  return Object.freeze({
    kind: 'wood-volume-sample:v1',
    primitiveId,
    growthCoordinates: Object.freeze(position),
    radial,
    ring,
    ray,
    fiber,
    density,
    baseColor,
    roughness: clampUnit(0.78 - 0.22 * latewood - 0.08 * ray),
    activeScales: weights.reduce((count, weight) => count + Number(weight > 0), 0),
  });
}

export function createWoodVolumeFieldReference(identity) {
  const root = createConditionedRoot(identity);
  const field = Object.freeze({
    kind: 'wood-volume-field:v1',
    identity: root,
    maxScales: SCALE_WAVELENGTHS.length,
  });
  fieldState.set(field, {
    root,
    treeFields: new Map(),
    samples: new Map(),
  });
  return field;
}

export function sampleWoodVolumeReference(
  field,
  coordinates,
  segmentIndex,
  point,
  { detailLevel, footprint },
) {
  const state = fieldState.get(field);
  if (!state) throw new TypeError('wood volume field is required');
  requireCoordinates(coordinates);
  if (
    !Number.isSafeInteger(segmentIndex)
    || segmentIndex < 0
    || segmentIndex >= coordinates.segmentCount
  ) {
    throw new RangeError('wood volume segmentIndex is outside the coordinate working set');
  }
  requirePoint(point);
  requireOptions(detailLevel, footprint);
  const primitiveId = coordinates.primitiveIds[segmentIndex];
  const key = sampleKey(primitiveId, point, detailLevel, footprint);
  const cached = state.samples.get(key);
  if (cached) {
    state.samples.delete(key);
    state.samples.set(key, cached);
    return cached;
  }
  const segment = coordinates.segments[segmentIndex];
  const sample = volumeSample(
    treeField(state, primitiveId),
    primitiveId,
    growthPosition(segment, point),
    detailLevel,
    footprint,
  );
  state.samples.set(key, sample);
  if (state.samples.size > MAX_SAMPLES) {
    state.samples.delete(state.samples.keys().next().value);
  }
  return sample;
}
