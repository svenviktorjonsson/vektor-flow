import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import test from 'node:test';

const executable = process.env.VKF_TERRAIN_CELL_REFINEMENT_TEST ?? resolve('build/terrain/cell-refinement-native');
if (!process.env.VKF_TERRAIN_CELL_REFINEMENT_TEST) {
  mkdirSync('build/terrain', { recursive: true });
  const built = spawnSync(process.env.CXX ?? 'g++', ['-std=c++20', '-O2', '-ffp-contract=off',
    '-Wall', '-Wextra', '-Werror', '-pedantic', '-I.', 'native/material/vf_terrain_cell_refinement_test.cpp',
    '-o', executable], { encoding: 'utf8' });
  assert.equal(built.status, 0, `${built.error ?? ''}${built.stdout}${built.stderr}`);
}
function run(args = []) {
  const result = spawnSync(executable, args, { timeout: 30000, maxBuffer: 16 * 1024 * 1024 });
  assert.equal(result.status, 0, `${result.error ?? ''}${result.stderr}`);
  assert.equal(result.stderr.length, 0);
  return result.stdout;
}
test('refinement preserves complete ordered groups, exact anchors and strict budgets', () => {
  assert.equal(run().toString(), 'terrain cell refinement: groups=complete anchors=exact\n');
});
test('refinement replay preserves request, parent, child, surface and waterline bytes', () => {
  const first = run(['--trace']);
  assert.deepEqual(run(['--trace']), first);
  assert.equal(first.length, 8141200);
  assert.equal(createHash('sha256').update(first).digest('hex'),
    '1c9a287dc1713cf6f966c4d8f74ed678a468685a8fb80103179c28f98753bc2a');
});
