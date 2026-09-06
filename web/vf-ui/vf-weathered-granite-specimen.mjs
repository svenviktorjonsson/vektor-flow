import {
  conditionedNodeStreamReference,
  conditionChild,
  createConditionedRoot,
  sampleBoundedUniform,
} from './vf-conditioned-distribution.mjs';
import {
  sampleSpatialCorrelation2Reference,
} from './vf-spatial-correlation.mjs';

const SECTORS = 72;
const RINGS = 36;
const MAX_VECTOR_BYTES = 256 * 1024;

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const subtract = (a, b) => a.map((value, axis) => value - b[axis]);
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const length3 = (value) => Math.hypot(...value);
const normalize = (value) => {
  const length = length3(value);
  return value.map((component) => component / length);
};

function unit(node, lane) {
  return sampleBoundedUniform(node, [0, lane], { min: 0, max: 1 });
}

function correlation(node, u, v, wavelength) {
  return sampleSpatialCorrelation2Reference(node, [u, v], {
    correlationLength: wavelength,
    mean: 0,
    amplitude: 1,
  });
}

function triangleArea(a, b, c) {
  return length3(cross(subtract(b, a), subtract(c, a))) * 0.5;
}

function range(values) {
  return Math.max(...values) - Math.min(...values);
}

function correlationCoefficient(first, second) {
  const meanA = first.reduce((sum, value) => sum + value, 0) / first.length;
  const meanB = second.reduce((sum, value) => sum + value, 0) / second.length;
  let numerator = 0;
  let squareA = 0;
  let squareB = 0;
  first.forEach((value, index) => {
    const a = value - meanA;
    const b = second[index] - meanB;
    numerator += a * b;
    squareA += a * a;
    squareB += b * b;
  });
  return numerator / Math.sqrt(squareA * squareB);
}

function createTopology() {
  const indices = [];
  const ringIndex = (ring, sector) => 1 + ring * SECTORS + (sector % SECTORS);
  for (let sector = 0; sector < SECTORS; sector += 1) {
    indices.push(0, ringIndex(0, sector + 1), ringIndex(0, sector));
  }
  for (let ring = 0; ring < RINGS - 1; ring += 1) {
    for (let sector = 0; sector < SECTORS; sector += 1) {
      const a = ringIndex(ring, sector);
      const b = ringIndex(ring, sector + 1);
      const c = ringIndex(ring + 1, sector);
      const d = ringIndex(ring + 1, sector + 1);
      indices.push(a, b, c, b, d, c);
    }
  }
  const top = 1 + RINGS * SECTORS;
  for (let sector = 0; sector < SECTORS; sector += 1) {
    indices.push(ringIndex(RINGS - 1, sector), ringIndex(RINGS - 1, sector + 1), top);
  }
  return new Uint32Array(indices);
}

export function createWeatheredGraniteSpecimenReference(
  identity,
  {
    microrelief = false,
    microshadow = true,
    granularMicrorelief = false,
    roundedUnderside = false,
  } = {},
) {
  const root = createConditionedRoot(identity);
  const formNode = conditionChild(root, {
    segment: 'stone:weathered-granite:v1',
    channel: 'shared-geology-form',
  });
  const detailNode = conditionChild(formNode, {
    segment: 'stone:weathered-granite:surface',
    channel: 'mineral-fracture-weathering',
  });
  const radiusX = 2.25 + unit(formNode, 1) * 0.45;
  const radiusY = 1.65 + unit(formNode, 2) * 0.42;
  const height = 1.68 + unit(formNode, 3) * 0.34;
  const leanX = (unit(formNode, 4) - 0.5) * 0.34;
  const leanY = (unit(formNode, 5) - 0.5) * 0.28;
  const phase = unit(formNode, 6) * Math.PI * 2;
  const fractureCount = 3 + Math.floor(unit(formNode, 7) * 5);
  const fractures = Array.from({ length: fractureCount }, (_, index) => ({
    angle: unit(formNode, 20 + index * 3) * Math.PI * 2,
    height: 0.22 + unit(formNode, 21 + index * 3) * 0.66,
    depth: 0.055 + unit(formNode, 22 + index * 3) * 0.085,
  }));
  const baseContactScores = Array.from({ length: SECTORS }, (_, sector) => {
    const u = sector / SECTORS;
    const angle = u * Math.PI * 2;
    return 0.55 * correlation(formNode, u * 5.1, 0.13, 0.31)
      + 0.25 * Math.sin(angle * 3 + phase * 0.73)
      + 0.20 * Math.sin(angle * 7 - phase * 0.41);
  });
  const rankedBaseSectors = baseContactScores
    .map((score, sector) => ({ score, sector }))
    .sort((a, b) => a.score - b.score);
  const contactSectors = new Set(rankedBaseSectors.slice(0, 12).map(({ sector }) => sector));
  for (let bin = 0; bin < 8; bin += 1) {
    const start = bin * (SECTORS / 8);
    const localMinimum = rankedBaseSectors.find(
      ({ sector }) => sector >= start && sector < start + SECTORS / 8,
    );
    contactSectors.add(localMinimum.sector);
  }
  const scoreMinimum = rankedBaseSectors[0].score;
  const scoreSpan = rankedBaseSectors.at(-1).score - scoreMinimum;
  const baseLifts = baseContactScores.map((score, sector) => (
    contactSectors.has(sector)
      ? 0
      : 0.010 + 0.045 * ((score - scoreMinimum) / scoreSpan)
  ));
  const positions = [[0, 0, 0]];
  const surfaceCoordinates = [[0.5, 0]];
  const radialValues = [];
  const neighborSteps = [];
  const geologicalDisplacement = [0];
  const flecks = [false];
  const cracks = [false];
  for (let ring = 0; ring < RINGS; ring += 1) {
    const path = roundedUnderside ? (ring + 1) / (RINGS + 1) : ring / RINGS;
    const t = roundedUnderside ? path : 1 - ((1 - path) ** 1.55);
    const profile = roundedUnderside
      ? Math.sin(Math.PI * t) ** 0.62 * (0.94 + 0.08 * t)
      : ((1 - t) ** 0.58) * (0.82 + 0.54 * t);
    let previousRadius = null;
    for (let sector = 0; sector < SECTORS; sector += 1) {
      const u = sector / SECTORS;
      const angle = u * Math.PI * 2;
      const broad = 0.17 * correlation(formNode, u * 2.4, t * 1.7, 0.62)
        + 0.075 * Math.sin(angle * 3 + phase + t * 2.2)
        + 0.045 * Math.sin(angle * 5 - phase * 0.7 - t * 4.1);
      let chip = 0;
      let cracked = false;
      for (const fracture of fractures) {
        const angular = Math.atan2(
          Math.sin(angle - fracture.angle),
          Math.cos(angle - fracture.angle),
        );
        const distance = (angular / 0.23) ** 2 + ((t - fracture.height) / 0.19) ** 2;
        const influence = Math.exp(-distance * 0.5);
        chip += fracture.depth * influence;
        cracked ||= influence > 0.72;
      }
      chip = Math.min(chip, 0.22);
      const fine = 0.032 * correlation(detailNode, u * 8, t * 6, 0.23);
      const radialScale = Math.max(0.58, 1 + broad + fine - chip);
      const radial = profile * radialScale;
      const centerX = leanX * t + 0.06 * Math.sin(t * 5 + phase);
      const centerY = leanY * t + 0.04 * Math.sin(t * 4 - phase);
      positions.push([
        centerX + Math.cos(angle) * radiusX * radial,
        centerY + Math.sin(angle) * radiusY * radial,
        height * t + (ring === 0 && !roundedUnderside ? baseLifts[sector] : 0),
      ]);
      surfaceCoordinates.push([u, t]);
      radialValues.push(radialScale);
      geologicalDisplacement.push(broad + fine - chip);
      cracks.push(cracked);
      const mineral = correlation(detailNode, u * 23 + 7.3, t * 19 - 2.1, 0.16);
      flecks.push(mineral > 0.63 || mineral < -0.68);
      if (previousRadius !== null) neighborSteps.push(Math.abs(radialScale - previousRadius));
      previousRadius = radialScale;
    }
  }
  const topU = 0.37;
  const topBroad = 0.10 * correlation(formNode, topU * 2.4, 1.7, 0.62);
  positions.push([leanX, leanY, height * (1 + clamp(topBroad, -0.02, 0.02))]);
  surfaceCoordinates.push([topU, 1]);
  geologicalDisplacement.push(topBroad);
  flecks.push(false);
  cracks.push(false);

  const indices = createTopology();
  const accumulated = Array.from({ length: positions.length }, () => [0, 0, 0]);
  let minimumTriangleArea = Infinity;
  for (let offset = 0; offset < indices.length; offset += 3) {
    const ids = [indices[offset], indices[offset + 1], indices[offset + 2]];
    const faceNormal = cross(
      subtract(positions[ids[1]], positions[ids[0]]),
      subtract(positions[ids[2]], positions[ids[0]]),
    );
    minimumTriangleArea = Math.min(minimumTriangleArea, length3(faceNormal) * 0.5);
    ids.forEach((id) => {
      accumulated[id][0] += faceNormal[0];
      accumulated[id][1] += faceNormal[1];
      accumulated[id][2] += faceNormal[2];
    });
  }

  const vertices = new Float32Array(positions.length * 10);
  const roughness = new Float32Array(positions.length);
  const displacement = new Float32Array(positions.length);
  const baseNormals = new Float32Array(positions.length * 3);
  const packedCoordinates = new Float32Array(positions.length * 2);
  const luminance = [];
  const normalPerturbations = [];
  positions.forEach((position, vertex) => {
    const normal = normalize(accumulated[vertex]);
    const [u, v] = surfaceCoordinates[vertex];
    const geology = geologicalDisplacement[vertex];
    const grain = correlation(detailNode, u * 29 + 13, v * 23 - 9, 0.13);
    const vein = Math.exp(-((Math.sin((u * 11 + v * 4.3 + phase) * Math.PI) / 0.18) ** 2));
    const crack = cracks[vertex] ? 1 : 0;
    let color = [
      0.48 + geology * 0.24 + grain * 0.055,
      0.46 + geology * 0.20 + grain * 0.045,
      0.44 + geology * 0.17 + grain * 0.035,
    ];
    if (flecks[vertex]) {
      color = grain > 0 ? [0.78, 0.74, 0.68] : [0.12, 0.13, 0.14];
    }
    color = color.map((channel) => clamp(channel + vein * 0.09 - crack * 0.18, 0.08, 0.86));
    const tangent = normalize(Math.abs(normal[2]) < 0.9
      ? cross([0, 0, 1], normal)
      : cross([0, 1, 0], normal));
    const bitangent = normalize(cross(normal, tangent));
    const perturbU = grain * 0.075 + crack * 0.055;
    const perturbV = correlation(detailNode, u * 31 - 4, v * 27 + 6, 0.12) * 0.06;
    const perturbedNormal = normalize([
      normal[0] + tangent[0] * perturbU + bitangent[0] * perturbV,
      normal[1] + tangent[1] * perturbU + bitangent[1] * perturbV,
      normal[2] + tangent[2] * perturbU + bitangent[2] * perturbV,
    ]);
    const rough = clamp(0.74 - geology * 0.18 + crack * 0.12 - vein * 0.08, 0.46, 0.92);
    vertices.set([...position, ...perturbedNormal, ...color, 1], vertex * 10);
    roughness[vertex] = rough;
    displacement[vertex] = geology;
    packedCoordinates.set([u, v], vertex * 2);
    baseNormals.set(normal, vertex * 3);
    luminance.push(0.2126 * color[0] + 0.7152 * color[1] + 0.0722 * color[2]);
    normalPerturbations.push(Math.acos(clamp(dot(normal, perturbedNormal), -1, 1)));
  });
  const packet = Object.freeze({
    type: 'field_mesh',
    id: 'stone:weathered-granite:specimen',
    object_id: 1,
    mode3d: true,
    topology: 'triangle-list',
    static_vertices: true,
    static_indices: true,
    receives_lighting: true,
    casts_shadow: true,
    receives_shadow: true,
    specular_strength: 1 - roughness.reduce((sum, value) => sum + value, 0) / roughness.length,
    rock_material_gpu: Object.freeze({
      kind: 'rock-geology-weathering-gpu:v1',
      variant: granularMicrorelief
        ? (microshadow
          ? 'weathered-granite-granular'
          : 'weathered-granite-granular-no-shadow')
        : (microrelief
        ? (microshadow
          ? 'weathered-granite-microrelief'
          : 'weathered-granite-microrelief-no-shadow')
        : 'weathered-granite'),
      streamWords: Object.freeze((() => {
        const stream = conditionedNodeStreamReference(detailNode);
        return [...stream.counterPrefix, ...stream.key];
      })()),
      radii: Object.freeze([radiusX, radiusY, height]),
      detailLevel: 5,
      minimumFootprint: 0,
      maxOctaves: 6,
    }),
    vertices,
    indices,
    material_channels: Object.freeze({
      kind: 'weathered-granite-field:v1',
      roughness,
      displacement,
      surfaceCoordinates: packedCoordinates,
      baseNormals,
    }),
  });
  const baseRadii = positions.slice(1, SECTORS + 1).map(([x, y]) => Math.hypot(x, y));
  const basePositions = positions.slice(1, SECTORS + 1);
  const baseHeights = basePositions.map((position) => position[2]);
  const baseContactSectors = baseHeights
    .map((heightValue, sector) => (heightValue <= 1e-9 ? sector : -1))
    .filter((sector) => sector >= 0);
  const baseContactAngularBins = new Set(baseContactSectors.map(
    (sector) => Math.floor(sector * 12 / SECTORS),
  )).size;
  const allRadii = positions.slice(1, -1).map(([x, y]) => Math.hypot(x, y));
  const radialMean = radialValues.reduce((sum, value) => sum + value, 0) / radialValues.length;
  const radialDeviation = Math.sqrt(radialValues.reduce(
    (sum, value) => sum + (value - radialMean) ** 2,
    0,
  ) / radialValues.length);
  const opposite = Array.from({ length: SECTORS / 2 }, (_, sector) => (
    Math.abs(radialValues[sector] - radialValues[sector + SECTORS / 2])
  ));
  const vectorBytes = vertices.byteLength + indices.byteLength
    + roughness.byteLength + displacement.byteLength
    + packedCoordinates.byteLength + baseNormals.byteLength;
  if (vectorBytes > MAX_VECTOR_BYTES) {
    throw new RangeError('weathered granite specimen exceeds 256 KiB');
  }
  return Object.freeze({
    kind: 'weathered-granite-specimen:v1',
    identity: root,
    packet,
    vectorBytes,
    metrics: Object.freeze({
      minimumTriangleArea,
      minimumZ: Math.min(...positions.map((position) => position[2])),
      baseVertexCount: baseContactSectors.length,
      baseHeightSpan: range(baseHeights),
      undersideHeightSpan: range([positions[0][2], ...baseHeights]),
      baseContactAngularBins,
      supportRadius: Math.min(...baseRadii),
      maximumRadius: Math.max(...allRadii),
      centerOfMassProjectionInsideSupport: Math.hypot(
        positions.reduce((sum, value) => sum + value[0], 0) / positions.length,
        positions.reduce((sum, value) => sum + value[1], 0) / positions.length,
      ) < Math.min(...baseRadii) * 0.45,
      radialCoefficientOfVariation: radialDeviation / radialMean,
      oppositeSilhouetteAsymmetry: opposite.reduce((sum, value) => sum + value, 0) / opposite.length,
      maximumChipDepth: Math.max(...fractures.map(({ depth }) => depth)),
      maximumNeighborRadiusStep: Math.max(...neighborSteps),
      fractureCount,
      albedoSpan: range(luminance),
      roughnessSpan: range(roughness),
      normalPerturbationSpan: range(normalPerturbations),
      displacementSpan: range(geologicalDisplacement),
      geologyMaterialCorrelation: correlationCoefficient(
        geologicalDisplacement,
        Array.from(roughness),
      ),
      mineralFleckFraction: flecks.filter(Boolean).length / flecks.length,
      crackFraction: cracks.filter(Boolean).length / cracks.length,
    }),
  });
}
