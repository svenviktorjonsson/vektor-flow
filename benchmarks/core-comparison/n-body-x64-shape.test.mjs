import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const benchmarkRoot = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(benchmarkRoot, '..', '..');
const source = resolve(benchmarkRoot, 'published', 'n-body-large', 'vkf.vkf');

function focusedDriver() {
  const executable = `vkf-driver${process.platform === 'win32' ? '.exe' : ''}`;
  const candidates = [
    process.env.VKF_NBODY_NATIVE_DRIVER,
    process.platform === 'win32'
      ? resolve(tmpdir(), 'vektor-flow-core-comparison', 'native-compiler', executable)
      : resolve(benchmarkRoot, '.work', 'native-compiler', executable)
  ].filter(Boolean);
  const driver = candidates.find(existsSync);
  assert.ok(driver, `focused native compiler not found; checked ${candidates.join(', ')}`);
  return driver;
}

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

test('fixed n-body interactions elide runtime static-index materialization', () => {
  const driver = focusedDriver();
  const workRoot = mkdtempSync(resolve(tmpdir(), 'vkf-nbody-x64-shape-'));
  try {
    const manifest = compileNBody(driver, workRoot);
    const code = readFileSync(manifest.code_path);
    const materializations = countRaxImmediateMaterializations(code);
    assert.ok(
      materializations <= 177,
      `fixed n-body artifact retained ${materializations} immediate materializations; expected at most 177`
    );
  } finally {
    rmSync(workRoot, { recursive: true, force: true });
  }
});

test('handled-error edges block static cursor DCE scans', () => {
  const workRoot = mkdtempSync(resolve(tmpdir(), 'vkf-nbody-dce-handler-'));
  try {
    const compiler = process.env.CXX || 'clang++';
    const executable = resolve(
      workRoot,
      `n-body-dce-handler-safety${process.platform === 'win32' ? '.exe' : ''}`
    );
    const build = spawnSync(compiler, [
      '-std=c++17',
      '-I', repoRoot,
      resolve(benchmarkRoot, 'n-body-dce-handler-safety.test.cpp'),
      '-o', executable
    ], { encoding: 'utf8' });
    assert.equal(build.status, 0, `${build.stdout}\n${build.stderr}`.trim());
    const result = spawnSync(executable, [], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  } finally {
    rmSync(workRoot, { recursive: true, force: true });
  }
});

test('published n-body artifact preserves its numeric oracle', () => {
  const workRoot = mkdtempSync(resolve(tmpdir(), 'vkf-nbody-x64-result-'));
  try {
    const manifest = compileNBody(focusedDriver(), workRoot);
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
      `published n-body output changed: expected ${expected}, received ${actual}`
    );
  } finally {
    rmSync(workRoot, { recursive: true, force: true });
  }
});
