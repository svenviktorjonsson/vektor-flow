import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import test from 'node:test';

const executable = process.env.VKF_TERRAIN_RESIDENCY_TEST ?? resolve('build/terrain/residency-native');
if (!process.env.VKF_TERRAIN_RESIDENCY_TEST) {
  mkdirSync('build/terrain', { recursive: true });
  const built = spawnSync(process.env.CXX ?? 'g++', ['-std=c++20', '-O2', '-ffp-contract=off',
    '-Wall', '-Wextra', '-Werror', '-pedantic', '-I.', 'native/material/vf_terrain_residency_test.cpp',
    '-o', executable], { encoding: 'utf8' });
  assert.equal(built.status, 0, `${built.error ?? ''}${built.stdout}${built.stderr}`);
}
function run(args = []) {
  const result = spawnSync(executable, args, { timeout: 30000, maxBuffer: 16 * 1024 * 1024 });
  assert.equal(result.status, 0, `${result.error ?? ''}${result.stderr}`);
  assert.equal(result.stderr.length, 0);
  return result.stdout;
}
test('terrain residency preserves exact recency, immutable rejection and logical demand bounds', () => {
  assert.equal(run().toString(), 'terrain residency: replay=exact demand=bounded\n');
});
test('residency replay preserves every retained key and generated position byte', () => {
  const first = run(['--trace']);
  assert.deepEqual(run(['--trace']), first);
  assert.equal(first.length, 2340528);
  assert.equal(createHash('sha256').update(first).digest('hex'),
    'dd486e72228b6fa606d8c2419cb78bf7325871a5fc9d5329b84806e8416785cd');
});
