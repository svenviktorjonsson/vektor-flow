import {
  realizeRoadWearCellsReference,
} from './vf-road-wear-field.mjs';

const adapterMetadata = new WeakMap();

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

function requireInputs(constructionPackets, refinement) {
  if (
    !constructionPackets
    || constructionPackets.kind !== 'road-construction-renderer-packets:v1'
    || !Array.isArray(constructionPackets.packets)
    || !refinement
    || refinement.kind !== 'road-refinement-working-set:v1'
    || !Array.isArray(refinement.packets)
    || constructionPackets.packets.length !== refinement.packets.length
  ) {
    throw new TypeError('road construction packets and refinement are required');
  }
  for (let index = 0; index < constructionPackets.packets.length; index += 1) {
    const packet = constructionPackets.packets[index];
    const source = refinement.packets[index];
    if (
      !packet
      || packet.type !== 'field_mesh'
      || !(packet.vertices instanceof Float32Array)
      || packet.vertices.length !== 40
      || !(packet.indices instanceof Uint32Array)
      || packet.id !== source?.id?.replace('road-cell:', 'road:cell:')
      || !(source.coordinates instanceof Float32Array)
      || !(source.positions instanceof Float32Array)
      || !(source.layerIndices instanceof Uint16Array)
    ) {
      throw new TypeError('road construction packets and refinement are required');
    }
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

function wearPacket(base, source, wearField, potentialCellCount) {
  const wear = realizeRoadWearCellsReference(
    wearField,
    coordinateWorkingSet(source, potentialCellCount),
    { sampleBudget: 1 },
  );
  const wearDisplacement = wear.geometry.displacement[0];
  const wearIntensity = clamp01(-wearDisplacement / 0.025);
  const cellWetness = wear.material.wetness[0];
  const colorScale = (1 - wearIntensity * 0.18) * (1 - cellWetness * 0.25);
  const albedo = new Float32Array(3);
  for (let channel = 0; channel < 3; channel += 1) {
    albedo[channel] = base.material_channels.albedo[channel] * colorScale;
  }
  const roughness = new Float32Array([
    base.material_channels.roughness[0] + wearIntensity * (
      wear.material.roughness[0] - base.material_channels.roughness[0]
    ),
  ]);
  const vertices = new Float32Array(base.vertices);
  for (let vertex = 0; vertex < 4; vertex += 1) {
    const offset = vertex * 10;
    for (let axis = 0; axis < 3; axis += 1) {
      vertices[offset + axis] += vertices[offset + 3 + axis] * wearDisplacement;
    }
    vertices.set(albedo, offset + 6);
  }
  const materialChannels = Object.freeze({
    kind: 'road-construction-wear:v1',
    aggregateFraction: base.material_channels.aggregateFraction,
    binderFraction: base.material_channels.binderFraction,
    voidFraction: base.material_channels.voidFraction,
    albedo,
    roughness,
    constructionDisplacement: base.material_channels.displacement,
    trafficExposureDrivers: wear.drivers,
    wearDisplacement: wear.geometry.displacement,
    wetness: wear.material.wetness,
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
    + materialChannels.wetness.byteLength;
  return Object.freeze({
    ...base,
    vertices,
    specular_strength: 1 - roughness[0],
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

export function adaptRoadConstructionToWearPacketsReference(
  constructionPackets,
  refinement,
  wearField,
  previous,
) {
  requireInputs(constructionPackets, refinement);
  const previousData = previous === null ? null : adapterMetadata.get(previous);
  if (previous !== null && !previousData) {
    throw new TypeError('retained road wear packet state is invalid');
  }
  if (previousData && previousData.wearField !== wearField) {
    throw new RangeError('retained road wear packet state owns another field');
  }
  const canRetain = previousData !== null;
  const previousById = canRetain ? previousData.packetById : new Map();
  const previousConstructionById = canRetain
    ? previousData.constructionById
    : new Map();
  const previousSourceById = canRetain ? previousData.sourceById : new Map();
  const packetById = new Map();
  const constructionById = new Map();
  const sourceById = new Map();
  const upsert = [];
  const unchanged = [];
  const packets = constructionPackets.packets.map((base, index) => {
    const source = refinement.packets[index];
    const retained = previousConstructionById.get(base.id) === base
      && previousSourceById.get(base.id) === source;
    const packet = retained
      ? previousById.get(base.id)
      : wearPacket(base, source, wearField, refinement.potentialCellCount);
    packetById.set(base.id, packet);
    constructionById.set(base.id, base);
    sourceById.set(base.id, source);
    if (retained) unchanged.push(packet.id);
    else upsert.push(packet);
    return packet;
  });
  const remove = previousData === null ? [] : [...previousData.packetById]
    .filter(([id]) => !packetById.has(id))
    .map(([, packet]) => packet.id);
  const adapted = Object.freeze({
    kind: 'road-wear-renderer-packets:v1',
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
    packetById,
    constructionById,
    sourceById,
  }));
  return adapted;
}
