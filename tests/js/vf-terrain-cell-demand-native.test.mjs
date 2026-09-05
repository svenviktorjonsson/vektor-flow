import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import test from 'node:test';

const executable = process.env.VKF_TERRAIN_CELL_DEMAND_TEST ?? resolve('build/terrain/cell-demand-native');
if (!process.env.VKF_TERRAIN_CELL_DEMAND_TEST) {
  mkdirSync('build/terrain', { recursive: true });
  const built = spawnSync(process.env.CXX ?? 'g++', ['-std=c++20', '-O2', '-ffp-contract=off',
    '-Wall', '-Wextra', '-Werror', '-pedantic', '-I.', 'native/material/vf_terrain_cell_demand_test.cpp',
    '-o', executable], { encoding: 'utf8' });
  assert.equal(built.status, 0, `${built.error ?? ''}${built.stdout}${built.stderr}`);
}
function run(args = []) {
  const result = spawnSync(executable, args, { timeout: 30000, maxBuffer: 16 * 1024 * 1024 });
  assert.equal(result.status, 0, `${result.error ?? ''}${result.stderr}`);
  assert.equal(result.stderr.length, 0);
  return result.stdout;
}
test('cell planning preserves source order, unique corners, strict fit and existing consumers', () => {
  assert.equal(run().toString(), 'terrain cell demand: corners=ordered source=shared\n');
});
test('cell planning replay preserves all request, demand, surface and topology bytes', () => {
  const first = run(['--trace']);
  assert.deepEqual(run(['--trace']), first);
  assert.equal(first.length, 7861120);
  assert.equal(createHash('sha256').update(first).digest('hex'),
    '6de6bf001d2d0fe65d88f15ca41dbff060549a19c68092bb7c255eb94272a8ec');
});
