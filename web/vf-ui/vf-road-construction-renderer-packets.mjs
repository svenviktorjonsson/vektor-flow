import {
  realizeRoadConstructionCellsReference,
} from './vf-road-construction-field.mjs';
import {
  realizeRoadCoordinateCellsReference,
} from './vf-road-coordinate-field.mjs';

const adapterMetadata = new WeakMap();

function subtract(left, right) {
  return left.map((value, axis) => value - right[axis]);
}

function addScaled(origin, first, firstScale, second, secondScale) {
  return origin.map((value, axis) => (
    value + first[axis] * firstScale + second[axis] * secondScale
  ));
}

function cross(left, right) {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
}

function normalize(vector) {
  const length = Math.hypot(...vector);
  return vector.map((value) => value / length);
}

function objectId(id) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0 || 1;
}

function requireRefinement(workingSet) {
  if (
    !workingSet
    || workingSet.kind !== 'road-refinement-working-set:v1'
    || !Array.isArray(workingSet.packets)
    || !Number.isSafeInteger(workingSet.potentialCellCount)
    || workingSet.packets.some((packet) => (
      !packet
      || typeof packet.id !== 'string'
      || !Array.isArray(packet.cell)
      || packet.cell.length !== 3
      || !(packet.coordinates instanceof Float32Array)
      || packet.coordinates.length !== 3
      || !(packet.positions instanceof Float32Array)
      || packet.positions.length !== 3
      || !(packet.layerIndices instanceof Uint16Array)
      || packet.layerIndices.length !== 1
    ))
  ) {
    throw new TypeError('road refinement working set is required');
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

function neighboringStep(field, cell, axis, center) {
  const neighbor = [...cell];
  const previous = cell[axis] > 0;
  neighbor[axis] += previous ? -1 : 1;
  const sample = realizeRoadCoordinateCellsReference(field, {
    cells: [neighbor],
    cellBudget: 1,
  });
  const neighborPosition = Array.from(sample.geometry.positions);
  return previous
    ? subtract(center, neighborPosition)
    : subtract(neighborPosition, center);
}

function rendererPacket(source, coordinateField, constructionField, potentialCellCount) {
  const construction = realizeRoadConstructionCellsReference(
    constructionField,
    coordinateWorkingSet(source, potentialCellCount),
    { sampleBudget: 1 },
  );
  const center = Array.from(source.positions);
  const forward = neighboringStep(coordinateField, source.cell, 0, center);
  const lateral = neighboringStep(coordinateField, source.cell, 1, center);
  const normal = normalize(cross(forward, lateral));
  const displacement = construction.geometry.displacement[0];
  const displacedCenter = center.map((value, axis) => (
    value + normal[axis] * displacement
  ));
  const corners = [
    addScaled(displacedCenter, forward, -0.5, lateral, -0.5),
    addScaled(displacedCenter, forward, 0.5, lateral, -0.5),
    addScaled(displacedCenter, forward, 0.5, lateral, 0.5),
    addScaled(displacedCenter, forward, -0.5, lateral, 0.5),
  ];
  const vertices = new Float32Array(40);
  for (let vertex = 0; vertex < corners.length; vertex += 1) {
    vertices.set([
      ...corners[vertex],
      ...normal,
      ...construction.material.albedo,
      1,
    ], vertex * 10);
  }
  const indices = new Uint32Array([0, 1, 2, 0, 2, 3]);
  const materialChannels = Object.freeze({
    kind: constructionField.kind,
    aggregateFraction: construction.material.aggregateFraction,
    binderFraction: construction.material.binderFraction,
    voidFraction: construction.material.voidFraction,
    albedo: construction.material.albedo,
    roughness: construction.material.roughness,
    displacement: construction.geometry.displacement,
  });
  const vectorBytes = vertices.byteLength + indices.byteLength
    + materialChannels.aggregateFraction.byteLength
    + materialChannels.binderFraction.byteLength
    + materialChannels.voidFraction.byteLength
    + materialChannels.albedo.byteLength
    + materialChannels.roughness.byteLength
    + materialChannels.displacement.byteLength;
  return Object.freeze({
    type: 'field_mesh',
    id: source.id.replace('road-cell:', 'road:cell:'),
    object_id: objectId(source.id),
    mode3d: true,
    topology: 'triangle-list',
    static_vertices: true,
    static_indices: true,
    receives_lighting: true,
    casts_shadow: true,
    receives_shadow: true,
    vertices,
    indices,
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

export function adaptRoadRefinementToConstructionPacketsReference(
  workingSet,
  coordinateField,
  constructionField,
  previous,
) {
  requireRefinement(workingSet);
  const previousData = previous === null ? null : adapterMetadata.get(previous);
  if (previous !== null && !previousData) {
    throw new TypeError('retained road construction packet state is invalid');
  }
  if (
    previousData
    && (
      previousData.coordinateField !== coordinateField
      || previousData.constructionField !== constructionField
    )
  ) {
    throw new RangeError(
      'retained road construction packet state owns another field',
    );
  }
  const canRetain = previousData !== null;
  const previousById = canRetain ? previousData.packetById : new Map();
  const previousSourceById = canRetain ? previousData.sourceById : new Map();
  const packetById = new Map();
  const sourceById = new Map();
  const upsert = [];
  const unchanged = [];
  const packets = workingSet.packets.map((source) => {
    const retained = previousSourceById.get(source.id) === source;
    const packet = retained
      ? previousById.get(source.id)
      : rendererPacket(
        source,
        coordinateField,
        constructionField,
        workingSet.potentialCellCount,
      );
    packetById.set(source.id, packet);
    sourceById.set(source.id, source);
    if (retained) unchanged.push(packet.id);
    else upsert.push(packet);
    return packet;
  });
  const remove = previousData === null ? [] : [...previousData.packetById]
    .filter(([id]) => !packetById.has(id))
    .map(([, packet]) => packet.id);
  const adapted = Object.freeze({
    kind: 'road-construction-renderer-packets:v1',
    packets: Object.freeze(packets),
    delta: Object.freeze({
      upsert: Object.freeze(upsert),
      remove: Object.freeze(remove),
      unchanged: Object.freeze(unchanged),
      upload: uploadSummary(upsert),
    }),
  });
  adapterMetadata.set(adapted, Object.freeze({
    coordinateField,
    constructionField,
    packetById,
    sourceById,
  }));
  return adapted;
}
