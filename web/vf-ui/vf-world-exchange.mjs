export const VKF_WORLD_FORMAT = 'vkf.world';
export const VKF_WORLD_VERSION = 1;

export function createVkfWorld({
  dimension = 2,
  units = {},
  geometry = {},
  extensions = {}
} = {}) {
  const spatialDimension = Number(dimension);
  if (spatialDimension !== 2 && spatialDimension !== 3) {
    throw new TypeError('A VKF world dimension must be 2 or 3.');
  }
  const vertices = records(geometry.vertices, 'vertices').map((vertex) => ({
    id: id(vertex.id),
    position: position(vertex.position ?? vertex.properties?.position, spatialDimension),
    properties: jsonObject(vertex.properties, ['position'])
  }));
  const vertexIds = uniqueIds(vertices, 'vertex');
  const edges = records(geometry.edges ?? geometry.hyperedges, 'edges').map((edge) => ({
    id: id(edge.id),
    vertices: references(edge.vertices, vertexIds, 2, 'edge vertices'),
    properties: jsonObject(edge.properties)
  }));
  uniqueIds(edges, 'edge', vertexIds);
  const faces = records(geometry.faces, 'faces').map((face) => ({
    id: id(face.id),
    vertices: closedReferences(face.vertices, vertexIds, 3, 'face vertices'),
    properties: jsonObject(face.properties)
  }));
  const faceIds = uniqueIds(faces, 'face', new Set([...vertexIds, ...edges.map(({ id: value }) => value)]));
  const volumes = records(geometry.volumes, 'volumes').map((volume) => ({
    id: id(volume.id),
    faces: records(volume.faces, 'volume faces').map((incidence) => {
      const faceId = id(incidence.id);
      if (!faceIds.has(faceId)) throw new TypeError(`Unknown volume face: ${faceId}`);
      const orientation = Number(incidence.orientation);
      if (orientation !== -1 && orientation !== 1) {
        throw new TypeError('A volume face orientation must be -1 or 1.');
      }
      return { id: faceId, orientation };
    }),
    properties: jsonObject(volume.properties)
  }));
  uniqueIds(volumes, 'volume', new Set([...vertexIds, ...edges.map(({ id: value }) => value), ...faceIds]));

  return deepFreeze({
    format: VKF_WORLD_FORMAT,
    version: VKF_WORLD_VERSION,
    dimension: spatialDimension,
    units: jsonObject(units),
    geometry: { vertices, edges, faces, volumes },
    extensions: jsonObject(extensions)
  });
}

export function parseVkfWorld(source) {
  const value = typeof source === 'string' ? JSON.parse(source) : source;
  if (value?.format !== VKF_WORLD_FORMAT || Number(value?.version) !== VKF_WORLD_VERSION) {
    throw new TypeError('Unsupported VKF world document.');
  }
  return createVkfWorld(value);
}

export function serializeVkfWorld(world, { pretty = true } = {}) {
  return JSON.stringify(parseVkfWorld(world), null, pretty ? 2 : 0);
}

export function encodeVkfWorldMetadata(world) {
  const bytes = new TextEncoder().encode(serializeVkfWorld(world, { pretty: false }));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  if (typeof btoa === 'function') return btoa(binary);
  return globalThis.Buffer.from(bytes).toString('base64');
}

export function decodeVkfWorldMetadata(encoded) {
  const binary = typeof atob === 'function'
    ? atob(String(encoded).trim())
    : globalThis.Buffer.from(String(encoded).trim(), 'base64').toString('binary');
  return parseVkfWorld(new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0))));
}

function records(value, label) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array.`);
  return value;
}

function id(value) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError('Geometry ids must be non-empty strings.');
  return value;
}

function position(value, dimension) {
  if (!Array.isArray(value) || value.length < dimension) {
    throw new TypeError(`A ${dimension}D vertex requires ${dimension} coordinates.`);
  }
  const result = value.slice(0, dimension).map(Number);
  if (!result.every(Number.isFinite)) throw new TypeError('Vertex coordinates must be finite.');
  return result;
}

function references(value, known, minimum, label) {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array.`);
  const result = value.map(id);
  if (result.length < minimum || new Set(result).size !== result.length) {
    throw new TypeError(`${label} must contain at least ${minimum} distinct ids.`);
  }
  for (const reference of result) {
    if (!known.has(reference)) throw new TypeError(`Unknown geometry reference: ${reference}`);
  }
  return result;
}

function closedReferences(value, known, minimum, label) {
  const result = Array.isArray(value) ? [...value] : value;
  if (Array.isArray(result) && result.length > 1 && result[0] === result.at(-1)) result.pop();
  return references(result, known, minimum, label);
}

function uniqueIds(values, label, occupied = new Set()) {
  const result = new Set(occupied);
  const own = new Set();
  for (const value of values) {
    if (result.has(value.id)) throw new TypeError(`Duplicate ${label} id: ${value.id}`);
    result.add(value.id);
    own.add(value.id);
  }
  return own;
}

function jsonObject(value, omittedKeys = []) {
  if (value == null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) throw new TypeError('World properties must be objects.');
  const omitted = new Set(omittedKeys);
  return Object.fromEntries(Object.entries(jsonClone(value)).filter(([key]) => !omitted.has(key)));
}

function jsonClone(value) {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new TypeError('World data must be JSON serializable.');
  return JSON.parse(serialized);
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
