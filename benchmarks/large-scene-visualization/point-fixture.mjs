function mixedUnit(index, channel, seed) {
  let value = Math.imul(index + 1, 0x9e3779b1)
    ^ Math.imul(channel + 1, 0x85ebca6b)
    ^ (seed >>> 0);
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d);
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b);
  value ^= value >>> 16;
  return (value >>> 0) / 0x80000000 - 1;
}

export function generatePointFixtureBytes(fixture, pointCount) {
  if (fixture.generator !== 'vkf-point-mix-v1') {
    throw new Error(`unsupported fixture generator ${fixture.generator}`);
  }
  if (!Number.isSafeInteger(pointCount) || pointCount < 1) {
    throw new Error('point count must be a positive safe integer');
  }
  if (!Number.isSafeInteger(fixture.seed) || fixture.seed < 0 || fixture.seed > 0xffff_ffff) {
    throw new Error('fixture seed must be an unsigned 32-bit integer');
  }
  const bytes = new Uint8Array(pointCount * 2 * 4);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < pointCount; index += 1) {
    view.setFloat32(index * 8, mixedUnit(index, 0, fixture.seed), true);
    view.setFloat32(index * 8 + 4, mixedUnit(index, 1, fixture.seed), true);
  }
  return bytes;
}
