import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import test from 'node:test';

const executable = process.env.VKF_TERRAIN_SPARSE_RESIDENCY_TEST ?? resolve('build/terrain/sparse-residency-native');
if (!process.env.VKF_TERRAIN_SPARSE_RESIDENCY_TEST) {
  mkdirSync('build/terrain', { recursive: true });
  const built = spawnSync(process.env.CXX ?? 'g++', ['-std=c++20', '-O2', '-ffp-contract=off',
    '-Wall', '-Wextra', '-Werror', '-pedantic', '-I.', 'native/material/vf_terrain_sparse_residency_test.cpp',
    '-o', executable], { encoding: 'utf8' });
  assert.equal(built.status, 0, `${built.error ?? ''}${built.stdout}${built.stderr}`);
}
function run(args = []) {
  const result = spawnSync(executable, args, { timeout: 30000, maxBuffer: 16 * 1024 * 1024 });
  assert.equal(result.status, 0, `${result.error ?? ''}${result.stderr}`);
  assert.equal(result.stderr.length, 0);
  return result.stdout;
}
test('sparse residency preserves ordered identity, immutable rejection, eviction and direct consumers', () => {
  assert.equal(run().toString(), 'sparse terrain residency: replay=exact demand=ordered\n');
});
test('sparse residency replay retains every condition, address, recency and position byte', () => {
  const first = run(['--trace']);
  assert.deepEqual(run(['--trace']), first);
  assert.equal(first.length, 2196592);
  assert.equal(createHash('sha256').update(first).digest('hex'),
    '0562d7a5e716ee53ac52327397108870f7816e12f3bed2ea1975cb9e50c2a8f8');
});
