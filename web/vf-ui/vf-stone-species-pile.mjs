import {
  createWeatheredGraniteSpecimenReference,
} from './vf-weathered-granite-specimen.mjs';

export const STONE_SPECIES_PROFILES = Object.freeze([
  Object.freeze({ id: 'gray-granite', aspect: [1.00, 0.94, 0.94], roughness: [0.70, 0.94], albedo: [0.28, 0.82] }),
  Object.freeze({ id: 'red-granite', aspect: [1.08, 0.90, 0.98], roughness: [0.68, 0.93], albedo: [0.22, 0.74] }),
  Object.freeze({ id: 'pale-quartzite', aspect: [0.92, 1.04, 0.88], roughness: [0.66, 0.90], albedo: [0.52, 0.84] }),
  Object.freeze({ id: 'dark-basalt', aspect: [0.90, 0.92, 1.04], roughness: [0.80, 0.94], albedo: [0.10, 0.34] }),
  Object.freeze({ id: 'banded-gneiss', aspect: [1.16, 0.86, 0.82], roughness: [0.70, 0.90], albedo: [0.25, 0.68] }),
]);

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

function modelMatrix(center, yaw, scale) {
  const cosine = Math.cos(yaw);
  const sine = Math.sin(yaw);
  return [
    cosine * scale[0], sine * scale[0], 0, 0,
    -sine * scale[1], cosine * scale[1], 0, 0,
    0, 0, scale[2], 0,
    center[0], center[1], center[2], 1,
  ];
}

export function createStoneSpeciesPileReference() {
  const meshes = [];
  const individuals = [];
  for (let index = 0; index < 20; index += 1) {
    const speciesIndex = index % STONE_SPECIES_PROFILES.length;
    const individualIndex = Math.floor(index / STONE_SPECIES_PROFILES.length);
    const profile = STONE_SPECIES_PROFILES[speciesIndex];
    const seed0 = mix32(0x51f15e5d ^ Math.imul(speciesIndex + 1, 0x9e3779b1)
      ^ Math.imul(individualIndex + 1, 0x85ebca77));
    const seed1 = mix32(seed0 ^ 0xc2b2ae3d);
    const identity = Object.freeze({
      generator: 'vkf.conditioned', version: 1,
      seed: Object.freeze([seed0, seed1]), domain: 'material',
      hierarchy: Object.freeze(['world:highland', `stone:${profile.id}`, `individual:${individualIndex}`]),
      lod: 0, channel: 'geology',
    });
    const specimen = createWeatheredGraniteSpecimenReference(identity, {
      granularMicrorelief: true,
      microshadow: true,
      roundedUnderside: true,
    });
    const layer = index < 12 ? 0 : (index < 18 ? 1 : 2);
    const layerIndex = layer === 0 ? index : (layer === 1 ? index - 12 : index - 18);
    const layerCount = layer === 0 ? 10 : (layer === 1 ? 6 : 2);
    const baseScale = 0.205 + layer * 0.010 + unit(seed0, 1) * 0.022;
    const scale = profile.aspect.map((value, axis) => (
      value * baseScale * (0.94 + unit(seed0, 3 + axis) * 0.12)
    ));
    const angle = layerIndex / layerCount * Math.PI * 2
      + (layer === 1 ? 0.31 : 0) + (unit(seed1, 7) - 0.5) * 0.09;
    const innerBase = layer === 0 && layerIndex >= 10;
    const radiusX = layer === 0 ? 1.90 : (layer === 1 ? 0.96 : 0.26);
    const radiusY = layer === 0 ? 1.25 : (layer === 1 ? 0.60 : 0.10);
    const layerBase = layer === 0 ? 0 : (layer === 1 ? 0.29 : 0.57);
    const center = [
      (innerBase ? (layerIndex === 10 ? -0.43 : 0.43) : Math.cos(angle) * radiusX)
        + (unit(seed1, 8) - 0.5) * 0.06,
      (innerBase ? 0 : Math.sin(angle) * radiusY)
        + (unit(seed1, 10) - 0.5) * 0.05,
      layerBase - specimen.metrics.minimumZ * scale[2],
    ];
    const supportRadius = Math.max(
      specimen.metrics.maximumRadius * scale[0],
      specimen.metrics.maximumRadius * scale[1],
    );
    const yaw = unit(seed1, 9) * Math.PI * 2;
    const packet = Object.freeze({
      ...specimen.packet,
      id: `stone:pile:${profile.id}:${individualIndex}`,
      object_id: index + 1,
      _modelMatrix: modelMatrix(center, yaw, scale),
      rock_material_gpu: Object.freeze({
        ...specimen.packet.rock_material_gpu,
        speciesIndex,
      }),
    });
    meshes.push(packet);
    individuals.push(Object.freeze({
      index, speciesIndex, speciesId: profile.id, individualIndex, layer, identity,
      seed: Object.freeze([seed0, seed1]), center: Object.freeze(center.slice()),
      scale: Object.freeze(scale), yaw, supportRadius,
      vertexCount: packet.vertices.length / 10,
      triangleCount: packet.indices.length / 3,
      baseHeightSpan: specimen.metrics.baseHeightSpan,
      undersideHeightSpan: specimen.metrics.undersideHeightSpan,
      vectorBytes: specimen.vectorBytes,
    }));
  }
  return Object.freeze({
    kind: 'stone-species-pile:v1',
    profiles: STONE_SPECIES_PROFILES,
    individuals: Object.freeze(individuals),
    meshes: Object.freeze(meshes),
  });
}
