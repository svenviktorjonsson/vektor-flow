import {
  createVkfWorld,
  decodeVkfWorldMetadata,
  encodeVkfWorldMetadata,
  parseVkfWorld
} from './vf-world-exchange.mjs';

export const VKF_STEP_CAPABILITY = Object.freeze({ faceted: true, analyticBrep: false });

export function exportVkfWorldStep(input, { name = 'VKF world' } = {}) {
  const world = parseVkfWorld(input);
  if (world.dimension !== 3) throw new TypeError('STEP export requires a 3D VKF world.');
  const entities = [];
  const add = (value) => { entities.push(value); return `#${entities.length}`; };
  const points = new Map(world.geometry.vertices.map((vertex) => [vertex.id,
    add(`CARTESIAN_POINT('${stepString(vertex.id)}',(${vertex.position.map(stepNumber).join(',')}))`)
  ]));
  const faces = new Map();
  for (const face of world.geometry.faces) {
    const loop = add(`POLY_LOOP('',(${face.vertices.map((id) => points.get(id)).join(',')}))`);
    const bound = add(`FACE_OUTER_BOUND('',${loop},.T.)`);
    const [origin, axis, reference] = planeFrame(face.vertices.map((id) => world.geometry.vertices.find((vertex) => vertex.id === id).position));
    const originRef = add(`CARTESIAN_POINT('',(${origin.map(stepNumber).join(',')}))`);
    const axisRef = add(`DIRECTION('',(${axis.map(stepNumber).join(',')}))`);
    const referenceRef = add(`DIRECTION('',(${reference.map(stepNumber).join(',')}))`);
    const placement = add(`AXIS2_PLACEMENT_3D('',${originRef},${axisRef},${referenceRef})`);
    const plane = add(`PLANE('',${placement})`);
    faces.set(face.id, add(`ADVANCED_FACE('${stepString(face.id)}',(${bound}),${plane},.T.)`));
  }
  const products = [];
  const volumes = world.geometry.volumes.length
    ? world.geometry.volumes
    : world.geometry.faces.length ? [{ id: 'shell', faces: world.geometry.faces.map(({ id }) => ({ id, orientation: 1 })) }] : [];
  for (const volume of volumes) {
    const refs = volume.faces.map(({ id }) => faces.get(id)).filter(Boolean);
    const shell = add(`${refs.length >= 4 ? 'CLOSED_SHELL' : 'OPEN_SHELL'}('${stepString(volume.id)}',(${refs.join(',')}))`);
    products.push(add(`${refs.length >= 4 ? 'FACETED_BREP' : 'SHELL_BASED_SURFACE_MODEL'}('${stepString(volume.id)}',${refs.length >= 4 ? shell : `(${shell})`})`));
  }
  const metadata = encodeVkfWorldMetadata(world);
  const body = entities.map((entity, index) => `#${index + 1}=${entity};`).join('\n');
  return `ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION(('VKF faceted world'),'2;1');\nFILE_NAME('${stepString(name)}','','','','Vektor Flow','','');\nFILE_SCHEMA(('CONFIG_CONTROL_DESIGN'));\nENDSEC;\nDATA;\n/*VKF_WORLD_BASE64:${metadata}*/\n${body}\nENDSEC;\nEND-ISO-10303-21;\n`;
}

export function importVkfWorldStep(source) {
  const text = String(source);
  const metadata = text.match(/\/\*VKF_WORLD_BASE64:([A-Za-z0-9+/=\s]+)\*\//);
  if (metadata) return decodeVkfWorldMetadata(metadata[1]);
  const entities = new Map([...text.matchAll(/#(\d+)\s*=\s*([A-Z0-9_]+)\s*\(([^;]*)\)\s*;/gi)]
    .map(([, id, type, body]) => [`#${id}`, { type: type.toUpperCase(), body }]));
  const vertices = [];
  const pointIds = new Map();
  for (const [reference, entity] of entities) {
    if (entity.type !== 'CARTESIAN_POINT') continue;
    const tuple = entity.body.match(/\(\s*([-+0-9.E]+)\s*,\s*([-+0-9.E]+)\s*,\s*([-+0-9.E]+)\s*\)\s*$/i);
    if (!tuple) continue;
    const position = tuple.slice(1).map(Number);
    if (!position.every(Number.isFinite)) continue;
    const id = `v${vertices.length + 1}`;
    pointIds.set(reference, id);
    vertices.push({ id, position });
  }
  const faces = [];
  const edges = [];
  for (const entity of entities.values()) {
    if (entity.type !== 'POLY_LOOP') continue;
    const ids = [...entity.body.matchAll(/#\d+/g)].map(([reference]) => pointIds.get(reference)).filter(Boolean);
    if (ids.length < 3) continue;
    faces.push({ id: `f${faces.length + 1}`, vertices: ids });
    for (let index = 0; index < ids.length; index += 1) addEdge(edges, ids[index], ids[(index + 1) % ids.length]);
  }
  if (!faces.length) throw new TypeError('STEP import currently requires faceted POLY_LOOP geometry.');
  return createVkfWorld({ dimension: 3, geometry: { vertices, edges, faces } });
}

function addEdge(edges, from, to) {
  if (edges.some(({ vertices }) => vertices.includes(from) && vertices.includes(to))) return;
  edges.push({ id: `e${edges.length + 1}`, vertices: [from, to] });
}
function planeFrame(points) {
  const origin = points[0];
  const reference = normalize(subtract(points[1], origin));
  let axis = [0, 0, 1];
  for (let index = 2; index < points.length; index += 1) {
    const candidate = normalize(cross(reference, subtract(points[index], origin)));
    if (candidate.some((value) => Math.abs(value) > 1e-12)) { axis = candidate; break; }
  }
  return [origin, axis, reference];
}
function subtract(a, b) { return a.map((value, index) => value - b[index]); }
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function normalize(value) { const length = Math.hypot(...value); return length ? value.map((entry) => entry / length) : [0, 0, 0]; }
function stepNumber(value) { return Number(value).toExponential(15).replace('e', 'E'); }
function stepString(value) { return String(value).replaceAll("'", "''"); }
