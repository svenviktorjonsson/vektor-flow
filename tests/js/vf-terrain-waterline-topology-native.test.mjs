import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import test from 'node:test';

const executable = process.env.VKF_TERRAIN_WATERLINE_TOPOLOGY_TEST ??
  resolve('build/terrain/waterline-topology-native');
if (!process.env.VKF_TERRAIN_WATERLINE_TOPOLOGY_TEST) {
  mkdirSync('build/terrain', { recursive: true });
  const built = spawnSync(process.env.CXX ?? 'g++', ['-std=c++20', '-O2', '-ffp-contract=off',
    '-Wall', '-Wextra', '-Werror', '-pedantic', '-I.',
    'native/material/vf_terrain_waterline_topology_test.cpp', '-o', executable], { encoding: 'utf8' });
  assert.equal(built.status, 0, `${built.error ?? ''}${built.stdout}${built.stderr}`);
}

test('waterline segments retain first-emitter provenance and resolve stable topology identity', () => {
  const result = spawnSync(executable, { encoding: 'utf8', timeout: 30000 });
  assert.equal(result.status, 0, `${result.error ?? ''}${result.stderr}`);
  assert.equal(result.stderr, '');
  assert.equal(result.stdout, 'terrain waterline topology: first=retained identity=resolved\n');
});
