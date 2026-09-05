import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import test from 'node:test';

const executable = process.env.VKF_TERRAIN_ASSOCIATION_TEST ?? resolve('build/terrain/association-native');
if (!process.env.VKF_TERRAIN_ASSOCIATION_TEST) {
  mkdirSync('build/terrain', { recursive: true });
  const built = spawnSync(process.env.CXX ?? 'g++', ['-std=c++20', '-O2', '-ffp-contract=off',
    '-Wall', '-Wextra', '-Werror', '-pedantic', '-I.', 'native/material/vf_terrain_material_association_test.cpp',
    '-o', executable], { encoding: 'utf8' });
  assert.equal(built.status, 0, `${built.error ?? ''}${built.stdout}${built.stderr}`);
}
function run(args = []) {
  const result = spawnSync(executable, args, { timeout: 30000, maxBuffer: 16 * 1024 * 1024 });
  assert.equal(result.status, 0, `${result.error ?? ''}${result.stderr}`);
  assert.equal(result.stderr.length, 0);
  return result.stdout;
}
test('terrain associations retain exact records, ownership, order, diagnostics and hard caps', () => {
  assert.equal(run().toString(), 'terrain material association: source=owned records=exact\n');
});
test('association replay preserves complete existing record identity and terrain bytes', () => {
  const first = run(['--trace']);
  assert.deepEqual(run(['--trace']), first);
  assert.equal(first.length, 4232819);
  assert.equal(createHash('sha256').update(first).digest('hex'),
    '73ce596f838d9f3e9208df9dfb79da4be67af550e5f65238ff0e3a30dc0ed6de');
});
