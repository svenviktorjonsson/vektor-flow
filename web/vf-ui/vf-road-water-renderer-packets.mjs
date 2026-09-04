import {
  realizeRoadWaterCellsReference,
} from './vf-road-water-field.mjs';
import {
  realizeRoadWearCellsReference,
} from './vf-road-wear-field.mjs';

const adapterMetadata = new WeakMap();

function requireInputs(wearPackets, refinement) {
  if (
    wearPackets?.kind !== 'road-wear-renderer-packets:v1'
    || !Array.isArray(wearPackets.packets)
    || refinement?.kind !== 'road-refinement-working-set:v1'
    || !Array.isArray(refinement.packets)
    || wearPackets.packets.length !== refinement.packets.length
    || wearPackets.packets.some((packet, index) => (
      packet?.type !== 'field_mesh'
      || !(packet.vertices instanceof Float32Array)
      || packet.vertices.length !== 40
      || !(packet.indices instanceof Uint32Array)
      || !(refinement.packets[index]?.coordinates instanceof Float32Array)
    ))
  ) {
    throw new TypeError('road wear packets and refinement are required');
  }
}

function coordinateWorkingSet(source, potentialCellCount) {
  const shared = Object.freeze({
    coordinates: source.coordinates,
    positions: source.positions,
    layerIndices: source.layerIndices,
  });
  return Object.freeze({
    kind: 'road-coordinate-working-set:v1',
    cellCount: 1,
    potentialCellCount,
    geometry: shared,
    material: shared,
  });
}

function waterPacket(
  base,
  source,
  wearField,
  waterField,
  potentialCellCount,
) {
  const wear = realizeRoadWearCellsReference(
    wearField,
    coordinateWorkingSet(source, potentialCellCount),
    { sampleBudget: 1 },
  );
  const water = realizeRoadWaterCellsReference(
    waterField,
    wear,
    { sampleBudget: 1 },
  );
  const waterDepth = water.geometry.waterDepth[0];
  const coverage = water.geometry.waterCoverage[0];
  const vertices = new Float32Array(base.vertices);
  for (let vertex = 0; vertex < 4; vertex += 1) {
    const offset = vertex * 10;
    for (let axis = 0; axis < 3; axis += 1) {
      vertices[offset + axis] += vertices[offset + 3 + axis] * waterDepth;
    }
    vertices.set(water.material.albedo, offset + 6);
  }
  const materialChannels = Object.freeze({
    kind: 'road-surface-water:v1',
    aggregateFraction: base.material_channels.aggregateFraction,
    binderFraction: base.material_channels.binderFraction,
    voidFraction: base.material_channels.voidFraction,
    albedo: water.material.albedo,
    roughness: water.material.roughness,
    constructionDisplacement: base.material_channels.constructionDisplacement,
    trafficExposureDrivers: base.material_channels.trafficExposureDrivers,
    wearDisplacement: base.material_channels.wearDisplacement,
    wetness: water.material.wetness,
    waterCoverage: water.material.waterCoverage,
    waterDepth: water.material.waterDepth,
  });
  const vectorBytes = vertices.byteLength + base.indices.byteLength
    + materialChannels.aggregateFraction.byteLength
    + materialChannels.binderFraction.byteLength
    + materialChannels.voidFraction.byteLength
    + materialChannels.albedo.byteLength
    + materialChannels.roughness.byteLength
    + materialChannels.constructionDisplacement.byteLength
    + materialChannels.trafficExposureDrivers.byteLength
    + materialChannels.wearDisplacement.byteLength
    + materialChannels.wetness.byteLength
    + materialChannels.waterCoverage.byteLength
    + materialChannels.waterDepth.byteLength;
  return Object.freeze({
    ...base,
    vertices,
    specular_strength: base.specular_strength
      + coverage * (0.96 - base.specular_strength),
    material_channels: materialChannels,
    vectorBytes,
  });
}

function uploadSummary(packets) {
  return Object.freeze({
    packets: packets.length,
    bytes: packets.reduce((sum, packet) => sum + packet.vectorBytes, 0),
  });
}

export function adaptRoadWearToWaterPacketsReference(
  wearPackets,
  refinement,
  wearField,
  waterField,
  previous,
) {
  requireInputs(wearPackets, refinement);
  const previousData = previous === null ? null : adapterMetadata.get(previous);
  if (previous !== null && !previousData) {
    throw new TypeError('retained road water packet state is invalid');
  }
  if (
    previousData
    && (previousData.wearField !== wearField
      || previousData.waterField !== waterField)
  ) {
    throw new RangeError('retained road water packet state owns another field');
  }
  const previousById = previousData?.packetById ?? new Map();
  const previousWearById = previousData?.wearById ?? new Map();
  const previousSourceById = previousData?.sourceById ?? new Map();
  const packetById = new Map();
  const wearById = new Map();
  const sourceById = new Map();
  const upsert = [];
  const unchanged = [];
  const packets = wearPackets.packets.map((base, index) => {
    const source = refinement.packets[index];
    const retained = previousWearById.get(base.id) === base
      && previousSourceById.get(base.id) === source;
    const packet = retained
      ? previousById.get(base.id)
      : waterPacket(
        base,
        source,
        wearField,
        waterField,
        refinement.potentialCellCount,
      );
    packetById.set(base.id, packet);
    wearById.set(base.id, base);
    sourceById.set(base.id, source);
    if (retained) unchanged.push(packet.id);
    else upsert.push(packet);
    return packet;
  });
  const remove = previousData === null ? [] : [...previousData.packetById]
    .filter(([id]) => !packetById.has(id))
    .map(([, packet]) => packet.id);
  const adapted = Object.freeze({
    kind: 'road-water-renderer-packets:v1',
    packets: Object.freeze(packets),
    delta: Object.freeze({
      upsert: Object.freeze(upsert),
      remove: Object.freeze(remove),
      unchanged: Object.freeze(unchanged),
      upload: uploadSummary(upsert),
    }),
  });
  adapterMetadata.set(adapted, Object.freeze({
    wearField,
    waterField,
    packetById,
    wearById,
    sourceById,
  }));
  return adapted;
}
