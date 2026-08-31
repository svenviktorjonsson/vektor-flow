export const INDICATOR_PROTOCOL = Object.freeze({
  schema: 'vkf.retained-cloud-indicator',
  schemaVersion: 1,
  pointCount: 1_000_000,
  pointSizesPx: Object.freeze([1, 4]),
  strideBytes: 16,
  viewport: Object.freeze([1280, 720]),
  warmupFrames: 60,
  measuredFrames: 100,
  orbitFrames: 100,
  fixtureSeed: 144862629,
  timingBoundary: 'animation-frame callback through explicit GPU completion',
});

function mix32(value) {
  let mixed = value >>> 0;
  mixed = Math.imul(mixed ^ (mixed >>> 16), 0x7feb352d);
  mixed = Math.imul(mixed ^ (mixed >>> 15), 0x846ca68b);
  return (mixed ^ (mixed >>> 16)) >>> 0;
}

function coordinate(index, axis) {
  const bits = mix32(INDICATOR_PROTOCOL.fixtureSeed + Math.imul(index + 1, 0x9e3779b1) + axis);
  return (bits / 0xffffffff) * 2 - 1;
}

export function createCloudFixture(pointCount = INDICATOR_PROTOCOL.pointCount) {
  if (!Number.isSafeInteger(pointCount) || pointCount < 1) {
    throw new RangeError('pointCount must be a positive safe integer');
  }
  const bytes = new Uint8Array(pointCount * INDICATOR_PROTOCOL.strideBytes);
  const view = new DataView(bytes.buffer);
  const positions = new Float32Array(pointCount * 3);
  const colors = new Uint8Array(pointCount * 4);
  for (let index = 0; index < pointCount; index += 1) {
    const x = coordinate(index, 0);
    const y = coordinate(index, 1);
    const z = coordinate(index, 2);
    const position = index * 3;
    positions[position] = x;
    positions[position + 1] = y;
    positions[position + 2] = z;
    const color = index * 4;
    colors[color] = x >= 0 ? 230 : 51;
    colors[color + 1] = y >= 0 ? 210 : 70;
    colors[color + 2] = z >= 0 ? 245 : 80;
    colors[color + 3] = 255;
    const offset = index * INDICATOR_PROTOCOL.strideBytes;
    view.setFloat32(offset, positions[position], true);
    view.setFloat32(offset + 4, positions[position + 1], true);
    view.setFloat32(offset + 8, positions[position + 2], true);
    bytes.set(colors.subarray(color, color + 4), offset + 12);
  }
  return Object.freeze({ bytes, byteLength: bytes.byteLength, positions, colors, pointCount });
}

export async function fixtureSha256(bytes) {
  if (!(bytes instanceof Uint8Array)) throw new TypeError('fixture hash requires bytes');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

export function orbitProjection(frame, viewport = INDICATOR_PROTOCOL.viewport) {
  if (!Number.isSafeInteger(frame) || frame < 0 || frame >= INDICATOR_PROTOCOL.orbitFrames) {
    throw new RangeError(`frame ${frame} is outside the deterministic orbit`);
  }
  const [width, height] = viewport;
  const scale = Math.min(width, height) * 0.44;
  const angle = 2 * Math.PI * frame / INDICATOR_PROTOCOL.orbitFrames;
  return Object.freeze({
    worldOrigin: Object.freeze([0, 0, 0]),
    screenOrigin: Object.freeze([width / 2, height / 2]),
    xAxis: Object.freeze([scale * Math.cos(angle), 0]),
    yAxis: Object.freeze([0, -scale]),
    zAxis: Object.freeze([scale * Math.sin(angle), 0]),
  });
}
