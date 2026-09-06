import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const executable = process.env.VKF_TERRAIN_TOPOLOGY_IDENTITY_TEST ?? resolve('build/terrain/topology-identity-native');
if (!process.env.VKF_TERRAIN_TOPOLOGY_IDENTITY_TEST) {
  mkdirSync('build/terrain', { recursive: true });
  const built = spawnSync(process.env.CXX ?? 'g++', ['-std=c++20', '-O2', '-ffp-contract=off',
    '-Wall', '-Wextra', '-Werror', '-pedantic', '-I.', 'native/material/vf_terrain_topology_identity_test.cpp',
    '-o', executable], { encoding: 'utf8' });
  assert.equal(built.status, 0, `${built.error ?? ''}${built.stdout}${built.stderr}`);
}
function run(args = []) {
  const result = spawnSync(executable, args, { timeout: 30000, maxBuffer: 16 * 1024 * 1024 });
  assert.equal(result.status, 0, `${result.error ?? ''}${result.stderr}`);
  assert.equal(result.stderr.length, 0);
  return result.stdout;
}

test('native topology identities preserve ownership, caller order, source indices and exact diagnostics', () => {
  assert.equal(run().toString(), 'terrain topology identity: address=exact source=owned\n');
});

test('every full-demand triangle identity matches an independent grid-address oracle byte for byte', () => {
  const actual = run(['--trace']), count = 130048;
  const expected = Buffer.alloc(60 + count * 24);
  expected.writeBigUInt64LE(BigInt(count));
  [1, 2, 3, 4].forEach((value, i) => expected.writeUInt32LE(value, 8 + i * 4));
  [0.125, 0, 2].forEach((value, i) => expected.writeDoubleLE(value, 24 + i * 8));
  expected.writeInt32LE(-1, 48); expected.writeInt32LE(2, 52); expected.writeUInt32LE(8, 56);
  for (let ordinal = 0; ordinal < count; ++ordinal) {
    const cell = Math.floor(ordinal / 2), face = ordinal % 2;
    const a = Math.floor(cell / 256) * 257 + cell % 256, b = a + 1, c = a + 257, d = c + 1;
    const addresses = face === 0 ? [a, c, b] : [b, c, d];
    const offset = 60 + ordinal * 24;
    expected.writeBigUInt64LE(BigInt(cell), offset); expected.writeUInt32LE(face, offset + 8);
    addresses.forEach((address, corner) => expected.writeUInt32LE(65535 - address, offset + 12 + corner * 4));
  }
  assert.equal(actual.length, 3121212);
  assert.deepEqual(actual, expected);
  assert.equal(createHash('sha256').update(actual).digest('hex'),
    'f124786fc405072ff2591e8b9773337881b5f7f37bae7604369ab0503fb364dc');
});

test('topology identity replay preserves the exact retained field and ordered face trace', () => {
  assert.deepEqual(run(['--trace']), run(['--trace']));
});
