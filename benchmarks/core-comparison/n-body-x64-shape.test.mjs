import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const benchmarkRoot = dirname(fileURLToPath(import.meta.url));
const source = resolve(benchmarkRoot, 'published', 'n-body-large', 'vkf.vkf');

function compileNBody(driver, workRoot) {
  const isolatedSource = resolve(workRoot, basename(source));
  copyFileSync(source, isolatedSource);
  const result = spawnSync(driver, [
    '--aot',
    '--diagnostics',
    '--optimizer-policy', 'mask-ff',
    '--source', isolatedSource
  ], {
    encoding: 'utf8',
    env: { ...process.env, XDG_CACHE_HOME: resolve(workRoot, 'cache') }
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`.trim());
  const summary = JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));
  return JSON.parse(readFileSync(summary.manifest_path, 'utf8'));
}

function countRaxImmediateMaterializations(code) {
  let count = 0;
  for (let offset = 0; offset + 1 < code.length; offset += 1) {
    if (code[offset] === 0x48 && code[offset + 1] === 0xb8) count += 1;
  }
  return count;
}

function countHighRegisterFixedPairLoads(code) {
  let count = 0;
  for (let offset = 0; offset + 4 < code.length; offset += 1) {
    const highRegisterMovupd = code[offset] === 0x66 &&
      code[offset + 1] === 0x44 &&
      code[offset + 2] === 0x0f &&
      code[offset + 3] === 0x10;
    const rbpDisp32 = (code[offset + 4] & 0xc7) === 0x85;
    if (highRegisterMovupd && rbpDisp32) count += 1;
  }
  return count;
}

test('fixed n-body interactions elide runtime static-index materialization', () => {
  const driver = process.env.VKF_NBODY_NATIVE_DRIVER;
  assert.ok(driver, 'VKF_NBODY_NATIVE_DRIVER must name the focused native compiler');
  const workRoot = mkdtempSync(resolve(tmpdir(), 'vkf-nbody-x64-shape-'));
  try {
    const manifest = compileNBody(driver, workRoot);
    const code = readFileSync(manifest.code_path);
    const materializations = countRaxImmediateMaterializations(code);
    assert.ok(
      materializations <= 177,
      `fixed n-body artifact retained ${materializations} immediate materializations; expected at most 177`
    );
    const promotedPairs = countHighRegisterFixedPairLoads(code);
    assert.ok(
      promotedPairs >= 15,
      `fixed n-body artifact promoted ${promotedPairs} position pairs; expected at least 15`
    );
  } finally {
    rmSync(workRoot, { recursive: true, force: true });
  }
});

test('fixed-pair promotion preserves the published n-body result', () => {
  const driver = process.env.VKF_NBODY_NATIVE_DRIVER;
  assert.ok(driver, 'VKF_NBODY_NATIVE_DRIVER must name the focused native compiler');
  const workRoot = mkdtempSync(resolve(tmpdir(), 'vkf-nbody-x64-result-'));
  try {
    const manifest = compileNBody(driver, workRoot);
    const executable = resolve(
      dirname(manifest.code_path),
      `vkf${process.platform === 'win32' ? '.exe' : ''}`
    );
    const result = spawnSync(executable, [], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const actual = Number(result.stdout.trim());
    const expected = -0.16907807065934854;
    assert.ok(
      Math.abs(actual - expected) <= 1e-9,
      `fixed-pair promotion changed n-body output: expected ${expected}, received ${actual}`
    );
  } finally {
    rmSync(workRoot, { recursive: true, force: true });
  }
});
