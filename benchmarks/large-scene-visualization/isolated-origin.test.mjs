import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { startLargeSceneIsolatedOrigin } = require('../../tests/helpers/large_scene_isolated_origin.js');

test('serves only benchmark assets from a cross-origin-isolated loopback origin', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vkf-large-scene-origin-'));
  await writeFile(join(directory, 'benchmark.html'), '<!doctype html><script type="module" src="./large-scene-peer-bundle.mjs"></script>');
  await writeFile(join(directory, 'large-scene-peer-bundle.mjs'), 'globalThis.loaded = true;');
  const origin = await startLargeSceneIsolatedOrigin(directory);
  try {
    const page = await fetch(`${origin.url}/benchmark.html`);
    assert.equal(page.status, 200);
    assert.equal(page.headers.get('cross-origin-opener-policy'), 'same-origin');
    assert.equal(page.headers.get('cross-origin-embedder-policy'), 'require-corp');
    assert.equal(page.headers.get('cross-origin-resource-policy'), 'same-origin');
    assert.match(await page.text(), /large-scene-peer-bundle/);
    assert.equal((await fetch(`${origin.url}/not-owned.txt`)).status, 404);
    assert.equal((await fetch(`${origin.url}/../package.json`)).status, 404);
  } finally {
    await origin.close();
    await rm(directory, { recursive: true, force: true });
  }
});
