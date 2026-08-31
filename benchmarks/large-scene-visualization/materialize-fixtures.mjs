import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { generatePointFixtureBytes } from './point-fixture.mjs';

export function generatePointFixture(fixture, pointCount) {
  return Buffer.from(generatePointFixtureBytes(fixture, pointCount));
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
