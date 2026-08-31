import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const rendererUrl = new URL(
  '../../web/vf-ui/geom/vf-geom-wgpu.js',
  import.meta.url,
);

test('WebGPU renderer owns a 64-byte procedural grass blade instance pipeline', async () => {
  const source = await readFile(rendererUrl, 'utf8');

  assert.match(source, /struct GrassBladeInstVin/);
  assert.match(source, /fn vs_grass_blade_instance\(v: GrassBladeInstVin\)/);
  assert.match(source, /var grassBladeInstDesc = \{\s*arrayStride: 64,/);
  assert.match(source, /pipeGrassBladeInst = device\.createRenderPipeline/);
  assert.match(source, /part\.instanceKind === "grass-blade-list"/);
  assert.match(source, /this\._pipeGrassBladeInst = sg\.pipeGrassBladeInst \|\| null/);
});
