const coarsePacketByShape = new WeakMap();
const adapterMetadata = new WeakMap();

const ROCK_COLOR = Object.freeze([0.46, 0.42, 0.36, 1]);

function normalAt(position, radii) {
  const gradient = position.map((value, axis) => value / (radii[axis] ** 2));
  const length = Math.hypot(...gradient);
  return gradient.map((value) => value / length);
}

function packVertices(vertexIds, positions, radii) {
  const packed = new Float32Array(vertexIds.length * 10);
  vertexIds.forEach((id, index) => {
    const position = positions.get(id);
    const normal = normalAt(position, radii);
    packed.set([...position, ...normal, ...ROCK_COLOR], index * 10);
  });
  return packed;
}

function packIndices(faces, vertexIds) {
  const indexById = new Map(vertexIds.map((id, index) => [id, index]));
  return new Uint32Array(faces.flatMap(({ vertices }) => (
    vertices.map((id) => indexById.get(id))
  )));
}

function fieldMeshPacket({
  id,
  objectId,
  vertexIds,
  faces,
  positions,
  radii,
}) {
  return Object.freeze({
    type: 'field_mesh',
    id,
    object_id: objectId,
    mode3d: true,
    topology: 'triangle-list',
    static_vertices: true,
    static_indices: true,
    receives_lighting: true,
    casts_shadow: true,
    receives_shadow: true,
    vertex_ids: Object.freeze([...vertexIds]),
    face_ids: Object.freeze(faces.map(({ id: faceId }) => faceId)),
    vertices: packVertices(vertexIds, positions, radii),
    indices: packIndices(faces, vertexIds),
  });
}

function coarsePacket(coarse) {
  const cached = coarsePacketByShape.get(coarse);
  if (cached) {
    return cached;
  }
  const positions = new Map(coarse.vertices.map(({ id, position }) => [id, position]));
  const packet = fieldMeshPacket({
    id: `rock:${coarse.kind}:coarse`,
    objectId: 1,
    vertexIds: coarse.vertices.map(({ id }) => id),
    faces: coarse.faces,
    positions,
    radii: coarse.radii,
  });
  coarsePacketByShape.set(coarse, packet);
  return packet;
}

function detailPacket(coarse, entry) {
  const parent = coarse.faces.find(({ id }) => id === entry.face);
  const vertexIds = [
    ...parent.vertices,
    ...entry.vertices.map(({ id }) => id),
  ];
  const positions = new Map([
    ...coarse.vertices.map(({ id, position }) => [id, position]),
    ...entry.vertices.map(({ id, position }) => [id, position]),
  ]);
  return fieldMeshPacket({
    id: `rock:detail:${entry.face}`,
    objectId: coarse.faces.findIndex(({ id }) => id === entry.face) + 2,
    vertexIds,
    faces: entry.faces,
    positions,
    radii: coarse.radii,
  });
}

function uploadSummary(packets) {
  return Object.freeze({
    packets: packets.length,
    vertices: packets.reduce((sum, packet) => sum + packet.vertex_ids.length, 0),
    faces: packets.reduce((sum, packet) => sum + packet.face_ids.length, 0),
    vertexFloats: packets.reduce((sum, packet) => sum + packet.vertices.length, 0),
    indices: packets.reduce((sum, packet) => sum + packet.indices.length, 0),
  });
}

function requireWorkingSet(workingSet) {
  if (
    !workingSet
    || typeof workingSet !== 'object'
    || !workingSet.coarse
    || workingSet.coarse.kind !== 'ellipsoid-octahedron:v1'
    || !Array.isArray(workingSet.coarse.vertices)
    || !Array.isArray(workingSet.coarse.faces)
    || !Array.isArray(workingSet.entries)
  ) {
    throw new TypeError('ellipsoid refinement working set is required');
  }
}

export function adaptEllipsoidWorkingSetToRetainedGeometryPacketsReference(
  workingSet,
  previous,
) {
  requireWorkingSet(workingSet);
  const coarse = workingSet.coarse;
  const previousData = previous === null ? null : adapterMetadata.get(previous);
  if (previous !== null && !previousData) {
    throw new TypeError('retained rock geometry packet state is invalid');
  }
  if (previousData && previousData.coarse !== coarse) {
    throw new RangeError('retained rock geometry packet state owns another coarse shape');
  }
  const basePacket = coarsePacket(coarse);
  const previousByFace = previousData?.coarse === coarse
    ? previousData.detailByFace
    : new Map();
  const previousEntryByFace = previousData?.coarse === coarse
    ? previousData.entryByFace
    : new Map();
  const detailByFace = new Map();
  const entryByFace = new Map();
  const upsert = [];
  const unchanged = [];

  if (previous === null) {
    upsert.push(basePacket);
  } else {
    unchanged.push(basePacket.id);
  }
  for (const entry of workingSet.entries) {
    const retained = previousEntryByFace.get(entry.face) === entry;
    const packet = retained
      ? previousByFace.get(entry.face)
      : detailPacket(coarse, entry);
    detailByFace.set(entry.face, packet);
    entryByFace.set(entry.face, entry);
    if (retained) {
      unchanged.push(packet.id);
    } else {
      upsert.push(packet);
    }
  }
  const remove = previousData === null
    ? []
    : [...previousByFace.entries()]
      .filter(([face]) => !detailByFace.has(face))
      .map(([, packet]) => packet.id);
  const packets = Object.freeze([
    basePacket,
    ...workingSet.entries.map(({ face }) => detailByFace.get(face)),
  ]);
  const adapted = Object.freeze({
    coarse: basePacket,
    packets,
    delta: Object.freeze({
      upsert: Object.freeze(upsert),
      remove: Object.freeze(remove),
      unchanged: Object.freeze(unchanged),
      upload: uploadSummary(upsert),
    }),
  });
  adapterMetadata.set(adapted, {
    coarse,
    detailByFace,
    entryByFace,
  });
  return adapted;
}
