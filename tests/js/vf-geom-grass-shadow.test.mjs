import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(
  new URL('../../web/vf-ui/geom/vf-geom-wgpu.js', import.meta.url),
  'utf8',
);

test('shadow WGSL expands the exact retained grass blade instance layout', () => {
  const shadowSource = source.match(/var SHADOW_SHADER = `([\s\S]*?)`;/)?.[1] ?? '';
  assert.match(shadowSource, /struct GrassBladeInstance/);
  assert.match(shadowSource, /@group\(1\) @binding\(0\) var<storage, read> grass_instances/);
  assert.match(shadowSource, /fn grass_color_instance_index\(shadow_instance_index: u32\)/);
  assert.match(shadowSource, /cell_index \* grass_shadow_params\.color_blades_per_cell \+ local_index/);
  assert.match(shadowSource, /grass_instances\[grass_color_instance_index\(instance_index\)\]/);
  assert.match(shadowSource, /fn vs_grass_shadow0\(/);
  assert.match(shadowSource, /fn vs_grass_shadow1\(/);
});

test('shadow pass selects instanced grass pipelines and bounded instance draws', () => {
  assert.match(source, /pipeGrassShadow0/);
  assert.match(source, /pipeGrassShadow1/);
  assert.match(source, /part\.instanceKind === "grass-blade-list"/);
  assert.match(source, /part\.grassGpuRuntime\.grassShadowBindGroup/);
  assert.match(source, /part\.grassGpuRuntime\.shadowInstanceCount/);
  assert.match(source, /pass\.setBindGroup\(1, grassShadowBindGroup\)/);
  assert.doesNotMatch(source, /vf-grass-shadow-blade-instances/);
  assert.match(source, /pass\.drawIndexed\(part\.ibCount, shadowInstanceCount/);
});

test('grass shadow fitting follows retained cell descriptors and revisions', () => {
  assert.match(source, /grassShadowWorldBounds/);
  assert.match(source, /mesh\.retained_signature/);
  assert.match(source, /mesh\.casts_shadow === true && part\.instanceKind === "grass-blade-list"/);
  assert.ok(
    source.indexOf('if (isGrassCaster && part._shadowWorldPointsModelSig === boundsSig')
      < source.indexOf('var grassBounds = isGrassCaster ? grassShadowWorldBounds'),
    'unchanged grass demand must reuse cached bounds before scanning cell descriptors',
  );
});
