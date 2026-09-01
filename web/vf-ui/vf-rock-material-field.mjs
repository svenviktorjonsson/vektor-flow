import {
  conditionedNodeStreamReference,
  conditionChild,
  createConditionedRoot,
} from './vf-conditioned-distribution.mjs';
import {
  sampleSpatialCorrelation2Reference,
} from './vf-spatial-correlation.mjs';

const fieldState = new WeakMap();
const floatBitsBuffer = new ArrayBuffer(8);
const floatBitsView = new DataView(floatBitsBuffer);
const MAX_OCTAVES = 6;
const DERIVATIVE_STEP = 1e-4;
const DARK_COLOR = Object.freeze([0.22, 0.19, 0.15]);
const WEATHERED_COLOR = Object.freeze([0.55, 0.49, 0.4]);

function clampUnit(value) {
  return Math.max(0, Math.min(1, value));
}

function requireSurfaceCoordinates(value) {
  const isTypedArray = ArrayBuffer.isView(value) && !(value instanceof DataView);
  if ((!Array.isArray(value) && !isTypedArray) || value.length !== 2) {
    throw new TypeError('rock surface coordinates must contain exactly two numbers');
  }
  for (let axis = 0; axis < 2; axis += 1) {
    if (typeof value[axis] !== 'number') {
      throw new TypeError(`rock surface coordinate[${axis}] must be a number`);
    }
    if (!Number.isFinite(value[axis])) {
      throw new RangeError(`rock surface coordinate[${axis}] must be finite`);
    }
  }
}

function requireOptions({ detailLevel, footprint }) {
  if (!Number.isSafeInteger(detailLevel) || detailLevel < 0) {
    throw new RangeError('rock material detailLevel must be a non-negative safe integer');
  }
  if (typeof footprint !== 'number') {
    throw new TypeError('rock material footprint must be a number');
  }
  if (!Number.isFinite(footprint) || footprint < 0) {
    throw new RangeError('rock material footprint must be finite and non-negative');
  }
}

function float64Key(value) {
  floatBitsView.setFloat64(0, value, true);
  return `${floatBitsView.getUint32(4, true).toString(16)}:${floatBitsView.getUint32(0, true).toString(16)}`;
}

function materialSampleKey(surfaceCoordinates, detailLevel, footprint) {
  return `${float64Key(surfaceCoordinates[0])}/${float64Key(surfaceCoordinates[1])}/${detailLevel}/${float64Key(footprint)}`;
}

function filterWeight(wavelength, footprint) {
  if (footprint <= wavelength * 0.5) return 1;
  if (footprint >= wavelength) return 0;
  const ratio = (wavelength - footprint) / (wavelength * 0.5);
  return ratio * ratio * (3 - 2 * ratio);
}

function rawGeology(node, surfaceCoordinates, detailLevel, footprint) {
  const octaveCount = Math.min(MAX_OCTAVES, detailLevel + 2);
  let weighted = 0;
  let totalWeight = 0;
  for (let octave = 0; octave < octaveCount; octave += 1) {
    const wavelength = 2 ** -octave;
    const weight = (0.56 ** octave) * filterWeight(wavelength, footprint);
    if (!(weight > 0)) continue;
    weighted += weight * sampleSpatialCorrelation2Reference(
      node,
      surfaceCoordinates,
      { correlationLength: wavelength, mean: 0, amplitude: 1 },
    );
    totalWeight += weight;
  }
  return totalWeight > 0 ? weighted / totalWeight : 0;
}

function normalizedTangentNormal(derivativeU, derivativeV) {
  const x = -derivativeU * 0.18;
  const y = -derivativeV * 0.18;
  const length = Math.hypot(x, y, 1);
  return Object.freeze([x / length, y / length, 1 / length]);
}

export function createRockMaterialFieldReference(identity) {
  const root = createConditionedRoot(identity);
  const node = conditionChild(root, {
    segment: 'rock:geology-weathering:v1',
    channel: 'shared-surface-field',
  });
  const field = Object.freeze({
    kind: 'rock-geology-weathering:v1',
    identity: root,
    maxOctaves: MAX_OCTAVES,
  });
  fieldState.set(field, { node, materialSamples: new Map() });
  return field;
}

export function createRockMaterialGpuDescriptorReference(
  field,
  { radii, detailLevel, minimumFootprint = 0 },
) {
  const state = fieldState.get(field);
  if (!state) {
    throw new TypeError('rock material field is required');
  }
  requireRadii(radii);
  requireOptions({ detailLevel, footprint: minimumFootprint });
  const stream = conditionedNodeStreamReference(state.node);
  return Object.freeze({
    kind: 'rock-geology-weathering-gpu:v1',
    streamWords: Object.freeze([
      ...stream.counterPrefix,
      ...stream.key,
    ]),
    radii: Object.freeze([...radii]),
    detailLevel,
    minimumFootprint,
    maxOctaves: MAX_OCTAVES,
  });
}

export function sampleRockMaterialReference(
  field,
  surfaceCoordinates,
  { detailLevel, footprint },
) {
  const state = fieldState.get(field);
  if (!state) {
    throw new TypeError('rock material field is required');
  }
  requireSurfaceCoordinates(surfaceCoordinates);
  requireOptions({ detailLevel, footprint });
  const cacheKey = materialSampleKey(surfaceCoordinates, detailLevel, footprint);
  const cached = state.materialSamples.get(cacheKey);
  if (cached) return cached;
  const geology = rawGeology(
    state.node,
    surfaceCoordinates,
    detailLevel,
    footprint,
  );
  const at = (offsetU, offsetV) => rawGeology(
    state.node,
    [surfaceCoordinates[0] + offsetU, surfaceCoordinates[1] + offsetV],
    detailLevel,
    footprint,
  );
  const derivativeU = (
    at(DERIVATIVE_STEP, 0) - at(-DERIVATIVE_STEP, 0)
  ) / (2 * DERIVATIVE_STEP);
  const derivativeV = (
    at(0, DERIVATIVE_STEP) - at(0, -DERIVATIVE_STEP)
  ) / (2 * DERIVATIVE_STEP);
  const weathering = clampUnit(0.5 + 0.5 * geology);
  const baseColor = Object.freeze([
    DARK_COLOR[0] + (WEATHERED_COLOR[0] - DARK_COLOR[0]) * weathering,
    DARK_COLOR[1] + (WEATHERED_COLOR[1] - DARK_COLOR[1]) * weathering,
    DARK_COLOR[2] + (WEATHERED_COLOR[2] - DARK_COLOR[2]) * weathering,
    1,
  ]);
  const sample = Object.freeze({
    geology,
    weathering,
    baseColor,
    roughness: 0.92 - 0.34 * weathering,
    displacement: 0.08 * geology,
    derivative: Object.freeze([derivativeU, derivativeV]),
    tangentNormal: normalizedTangentNormal(derivativeU, derivativeV),
  });
  state.materialSamples.set(cacheKey, sample);
  return sample;
}

function requireRadii(radii) {
  const isTypedArray = ArrayBuffer.isView(radii) && !(radii instanceof DataView);
  if ((!Array.isArray(radii) && !isTypedArray) || radii.length !== 3) {
    throw new TypeError('rock material radii must contain exactly three numbers');
  }
  for (let axis = 0; axis < 3; axis += 1) {
    if (typeof radii[axis] !== 'number') {
      throw new TypeError(`rock material radius[${axis}] must be a number`);
    }
    if (!Number.isFinite(radii[axis]) || !(radii[axis] > 0)) {
      throw new RangeError(`rock material radius[${axis}] must be finite and positive`);
    }
  }
}

function signNotZero(value) {
  return value < 0 ? -1 : 1;
}

export function rockEllipsoidSurfaceCoordinatesReference(position, radii) {
  if (!position || position.length !== 3) {
    throw new TypeError('rock material position must contain exactly three numbers');
  }
  requireRadii(radii);
  const direction = position.map((value, axis) => {
    if (typeof value !== 'number') {
      throw new TypeError(`rock material position[${axis}] must be a number`);
    }
    if (!Number.isFinite(value)) {
      throw new RangeError(`rock material position[${axis}] must be finite`);
    }
    return value / radii[axis];
  });
  const scale = Math.abs(direction[0]) + Math.abs(direction[1]) + Math.abs(direction[2]);
  if (!(scale > 0)) {
    throw new RangeError('rock material position must not be the ellipsoid origin');
  }
  const x = direction[0] / scale;
  const y = direction[1] / scale;
  const z = direction[2] / scale;
  if (z >= 0) {
    return Object.freeze([x, y]);
  }
  return Object.freeze([
    (1 - Math.abs(y)) * signNotZero(x),
    (1 - Math.abs(x)) * signNotZero(y),
  ]);
}

function normalize3(vector) {
  const length = Math.hypot(...vector);
  return vector.map((value) => value / length);
}

function cross3(first, second) {
  return [
    first[1] * second[2] - first[2] * second[1],
    first[2] * second[0] - first[0] * second[2],
    first[0] * second[1] - first[1] * second[0],
  ];
}

function worldNormal(baseNormal, tangentNormal) {
  const reference = Math.abs(baseNormal[2]) < 0.9 ? [0, 0, 1] : [0, 1, 0];
  const tangent = normalize3(cross3(reference, baseNormal));
  const bitangent = normalize3(cross3(baseNormal, tangent));
  return normalize3([
    tangent[0] * tangentNormal[0]
      + bitangent[0] * tangentNormal[1]
      + baseNormal[0] * tangentNormal[2],
    tangent[1] * tangentNormal[0]
      + bitangent[1] * tangentNormal[1]
      + baseNormal[1] * tangentNormal[2],
    tangent[2] * tangentNormal[0]
      + bitangent[2] * tangentNormal[1]
      + baseNormal[2] * tangentNormal[2],
  ]);
}

export function adaptRockMaterialToRendererPacketReference(
  packet,
  field,
  { radii, detailLevel, footprint },
) {
  if (
    !packet
    || packet.type !== 'field_mesh'
    || !(packet.vertices instanceof Float32Array)
    || packet.vertices.length % 10 !== 0
    || !(packet.indices instanceof Uint32Array)
  ) {
    throw new TypeError('rock field-mesh renderer packet is required');
  }
  requireRadii(radii);
  requireOptions({ detailLevel, footprint });
  if (!fieldState.has(field)) {
    throw new TypeError('rock material field is required');
  }
  const vertexCount = packet.vertices.length / 10;
  const vertices = new Float32Array(packet.vertices.length);
  const roughness = new Float32Array(vertexCount);
  const displacement = new Float32Array(vertexCount);
  const surfaceCoordinates = new Float32Array(vertexCount * 2);
  const baseNormals = new Float32Array(vertexCount * 3);
  const rockMaterialGpu = createRockMaterialGpuDescriptorReference(field, {
    radii,
    detailLevel,
    minimumFootprint: 0,
  });
  let roughnessSum = 0;
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const offset = vertex * 10;
    const position = Array.from(packet.vertices.slice(offset, offset + 3));
    const baseNormal = normalize3(Array.from(packet.vertices.slice(offset + 3, offset + 6)));
    const coordinates = rockEllipsoidSurfaceCoordinatesReference(position, radii);
    const sample = sampleRockMaterialReference(field, coordinates, {
      detailLevel,
      footprint,
    });
    const perturbedNormal = worldNormal(baseNormal, sample.tangentNormal);
    vertices.set([
      position[0] + baseNormal[0] * sample.displacement,
      position[1] + baseNormal[1] * sample.displacement,
      position[2] + baseNormal[2] * sample.displacement,
      ...perturbedNormal,
      ...sample.baseColor,
    ], offset);
    roughness[vertex] = sample.roughness;
    displacement[vertex] = sample.displacement;
    surfaceCoordinates.set(coordinates, vertex * 2);
    baseNormals.set(baseNormal, vertex * 3);
    roughnessSum += sample.roughness;
  }
  return Object.freeze({
    ...packet,
    vertices,
    specular_strength: 1 - roughnessSum / vertexCount,
    rock_material_gpu: rockMaterialGpu,
    material_channels: Object.freeze({
      kind: field.kind,
      roughness,
      displacement,
      surfaceCoordinates,
      baseNormals,
    }),
  });
}
