import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function mixedUnit(index, channel, seed) {
  let value = Math.imul(index + 1, 0x9e3779b1)
    ^ Math.imul(channel + 1, 0x85ebca6b)
    ^ (seed >>> 0);
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d);
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b);
  value ^= value >>> 16;
  return (value >>> 0) / 0x80000000 - 1;
}

export function generatePointFixture(fixture, pointCount) {
  if (fixture.generator !== 'vkf-point-mix-v1') {
    throw new Error(`unsupported fixture generator ${fixture.generator}`);
  }
  if (!Number.isSafeInteger(pointCount) || pointCount < 1) {
    throw new Error('point count must be a positive safe integer');
  }
  if (!Number.isSafeInteger(fixture.seed) || fixture.seed < 0 || fixture.seed > 0xffff_ffff) {
    throw new Error('fixture seed must be an unsigned 32-bit integer');
  }
  const bytes = Buffer.allocUnsafe(pointCount * 2 * 4);
  for (let index = 0; index < pointCount; index += 1) {
    bytes.writeFloatLE(mixedUnit(index, 0, fixture.seed), index * 8);
    bytes.writeFloatLE(mixedUnit(index, 1, fixture.seed), index * 8 + 4);
  }
  return bytes;
}

export function verifyManifestFixtures(manifest) {
  for (const workload of manifest.workloads ?? []) {
    const bytes = generatePointFixture(workload.fixture, workload.pointCount);
    const actual = createHash('sha256').update(bytes).digest('hex');
    if (actual !== workload.fixture.sha256) {
      throw new Error(`${workload.id} fixture hash ${actual}; expected ${workload.fixture.sha256}`);
    }
  }
  return true;
}

function main() {
  const root = dirname(fileURLToPath(import.meta.url));
  const manifest = JSON.parse(readFileSync(resolve(root, 'manifest.json'), 'utf8'));
  verifyManifestFixtures(manifest);
  console.log(`verified ${manifest.workloads.length} generated point fixtures`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
