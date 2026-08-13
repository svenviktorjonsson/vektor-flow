import {
  createVkfWorld,
  decodeVkfWorldMetadata,
  encodeVkfWorldMetadata,
  parseVkfWorld
} from './vf-world-exchange.mjs';

const METADATA_ID = 'vkf-world-exchange';

export function exportVkfWorldSvg(input, { padding = 16, vertexRadius = 3 } = {}) {
  const world = parseVkfWorld(input);
  if (world.dimension !== 2) throw new TypeError('SVG export requires a 2D VKF world.');
  const byId = new Map(world.geometry.vertices.map((vertex) => [vertex.id, vertex]));
  const bounds = worldBounds(world.geometry.vertices, padding);
  const faceIds = new Set(world.geometry.faces.flatMap(({ vertices }) => vertices));
  const edgeLines = world.geometry.edges.map((edge) => {
    const points = edge.vertices.map((id) => byId.get(id).position);
    const appearance = edge.properties.appearance || edge.properties;
    return `<polyline data-vkf-id="${xml(edge.id)}" points="${points.map(svgPoint).join(' ')}" fill="none" ${paint(appearance, 'none', '#bfc5d0')}/>`;
  }).join('');
  const faces = world.geometry.faces.map((face) => {
    const appearance = face.properties.appearance || face.properties;
    return `<polygon data-vkf-id="${xml(face.id)}" points="${face.vertices.map((id) => svgPoint(byId.get(id).position)).join(' ')}" ${paint(appearance, '#808080', '#bfc5d0')}/>`;
  }).join('');
  const vertices = world.geometry.vertices.map((vertex) => {
    const appearance = vertex.properties.appearance || vertex.properties;
    return `<circle data-vkf-id="${xml(vertex.id)}" cx="${number(vertex.position[0])}" cy="${number(-vertex.position[1])}" r="${number(vertexRadius)}" ${paint(appearance, appearance.color || '#ffffff', 'none')}/>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="${bounds.map(number).join(' ')}" data-vkf-y-up="true">\n<metadata id="${METADATA_ID}" data-encoding="base64-json">${encodeVkfWorldMetadata(world)}</metadata>\n<g data-vkf-layer="faces">${faces}</g>\n<g data-vkf-layer="edges">${edgeLines}</g>\n<g data-vkf-layer="vertices">${vertices}</g>\n</svg>\n`;
}

export function importVkfWorldSvg(source) {
  const text = String(source);
  const metadata = text.match(new RegExp(`<metadata\\b[^>]*id=["']${METADATA_ID}["'][^>]*>([\\s\\S]*?)<\\/metadata>`, 'i'));
  if (metadata) return decodeVkfWorldMetadata(metadata[1]);

  const vertices = [];
  const edges = [];
  const faces = [];
  const pointIds = new Map();
  const pointId = (x, y) => {
    const key = `${x},${y}`;
    if (pointIds.has(key)) return pointIds.get(key);
    const id = `v${vertices.length + 1}`;
    pointIds.set(key, id);
    vertices.push({ id, position: [x, -y] });
    return id;
  };
  for (const match of text.matchAll(/<(line|polyline|polygon|circle)\b([^>]*)\/?\s*>/gi)) {
    const [, tag, raw] = match;
    const attributes = attrs(raw);
    const properties = appearance(attributes);
    if (tag.toLowerCase() === 'circle') {
      pointId(finite(attributes.cx), finite(attributes.cy));
      continue;
    }
    const points = tag.toLowerCase() === 'line'
      ? [[finite(attributes.x1), finite(attributes.y1)], [finite(attributes.x2), finite(attributes.y2)]]
      : parsePoints(attributes.points);
    const ids = points.map(([x, y]) => pointId(x, y));
    if (tag.toLowerCase() === 'polygon') {
      faces.push({ id: attributes['data-vkf-id'] || `f${faces.length + 1}`, vertices: ids, properties });
      for (let index = 0; index < ids.length; index += 1) {
        addUniqueEdge(edges, ids[index], ids[(index + 1) % ids.length], properties);
      }
    } else {
      for (let index = 1; index < ids.length; index += 1) addUniqueEdge(edges, ids[index - 1], ids[index], properties);
    }
  }
  if (!vertices.length) throw new TypeError('SVG contains no supported line, polygon, polyline, or circle geometry.');
  return createVkfWorld({ dimension: 2, geometry: { vertices, edges, faces } });
}

function addUniqueEdge(edges, from, to, properties) {
  if (edges.some(({ vertices }) => vertices.includes(from) && vertices.includes(to))) return;
  edges.push({ id: `e${edges.length + 1}`, vertices: [from, to], properties });
}

function worldBounds(vertices, padding) {
  if (!vertices.length) return [-padding, -padding, padding * 2, padding * 2];
  const xs = vertices.map(({ position }) => position[0]);
  const ys = vertices.map(({ position }) => -position[1]);
  const minX = Math.min(...xs) - padding;
  const minY = Math.min(...ys) - padding;
  return [minX, minY, Math.max(1, Math.max(...xs) - Math.min(...xs)) + 2 * padding, Math.max(1, Math.max(...ys) - Math.min(...ys)) + 2 * padding];
}

function svgPoint([x, y]) { return `${number(x)},${number(-y)}`; }
function number(value) { return Number(value.toPrecision(15)).toString(); }
function xml(value) { return String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;'); }
function paint(value, defaultFill, defaultStroke) {
  const fill = value.fill ?? value.faceColor ?? defaultFill;
  const stroke = value.stroke ?? value.edgeColor ?? value.color ?? defaultStroke;
  const opacity = Number.isFinite(Number(value.opacity)) ? Number(value.opacity) : 1;
  const width = Number.isFinite(Number(value.lineWidth)) ? Number(value.lineWidth) : 1.5;
  return `fill="${xml(fill)}" stroke="${xml(stroke)}" stroke-width="${number(width)}" opacity="${number(opacity)}" stroke-linejoin="round" stroke-linecap="round"`;
}
function attrs(raw) {
  return Object.fromEntries([...raw.matchAll(/([:\w-]+)\s*=\s*["']([^"']*)["']/g)].map(([, key, value]) => [key.toLowerCase(), value]));
}
function finite(value) {
  const result = Number(value);
  if (!Number.isFinite(result)) throw new TypeError('SVG geometry coordinates must be finite.');
  return result;
}
function parsePoints(value = '') {
  const values = value.trim().split(/[\s,]+/).filter(Boolean).map(finite);
  if (values.length < 4 || values.length % 2) throw new TypeError('Invalid SVG points attribute.');
  return Array.from({ length: values.length / 2 }, (_, index) => [values[index * 2], values[index * 2 + 1]]);
}
function appearance(attributes) {
  return { appearance: Object.fromEntries(['fill', 'stroke', 'opacity', 'stroke-width'].filter((key) => attributes[key] != null).map((key) => [key === 'stroke-width' ? 'lineWidth' : key, attributes[key]])) };
}
