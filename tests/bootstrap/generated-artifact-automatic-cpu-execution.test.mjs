import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';

const compiler = process.env.VKF_AUTOMATIC_CPU_COMPILER;
const configuredWorkRoot = resolve(
  process.env.VKF_TEST_WORK_ROOT ?? join(import.meta.dirname, '.work'),
);
const suffix = process.platform === 'win32' ? '.exe' : '';

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    timeout: 120_000,
    windowsHide: true,
    ...options,
  });
  assert.equal(result.error, undefined, result.error?.message);
  return result;
}

function sourceFor(iterations, maxCores) {
  return [
    `process.max_cores: ${maxCores}`,
    'left_demand() -> num:',
    '    i: 0',
    '    value: 0',
    `    i < ${iterations}?>`,
    '        .value: value + 1',
    '        .i: i + 1',
    '    @: value',
    'right_demand() -> num:',
    '    i: 0',
    '    value: 0',
    `    i < ${iterations}?>`,
    '        .value: value + 2',
    '        .i: i + 1',
    '    @: value',
    'left: left_demand()',
    'right: right_demand()',
    ':: left',
    ':: right',
  ].join('\n');
}

function windowsThreadTimes(pid) {
  const powershell = join(
    process.env.SystemRoot,
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  );
  const observed = run(powershell, [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    `$p=Get-Process -Id ${pid} -ErrorAction SilentlyContinue; ` +
      "if ($p) { @($p.Threads | ForEach-Object { " +
      "[pscustomobject]@{id=$_.Id;ticks=$_.TotalProcessorTime.Ticks} " +
      '}) | ConvertTo-Json -Compress }',
  ], { timeout: 10_000 });
  const rendered = String(observed.stdout ?? '').trim();
  if (!rendered) return [];
  const parsed = JSON.parse(rendered);
  return Array.isArray(parsed) ? parsed : [parsed];
}

test('a selected generated demand pair executes on overlapping OS threads', {
  skip: process.platform === 'win32' && compiler
    ? false
    : 'Windows generated-artifact compiler is not configured',
  timeout: 180_000,
}, async () => {
  assert.equal(existsSync(compiler), true, 'configured VKF compiler does not exist');
  mkdirSync(configuredWorkRoot, { recursive: true });
  const work = mkdtempSync(join(configuredWorkRoot, 'i55-overlap-'));
  let child = null;
  try {
    const iterations = 2_000_000_000;
    const source = join(work, 'overlap.vkf');
    const artifact = join(work, `overlap${suffix}`);
    writeFileSync(source, sourceFor(iterations, 2), 'utf8');
    const compiled = run(compiler, ['-b', source, '-o', artifact, '--diagnostics']);
    assert.equal(compiled.status, 0, `${compiled.stdout}\n${compiled.stderr}`);
    const manifest = JSON.parse(readFileSync(
      join(work, '.vkfbuild', 'overlap', 'x64-manifest.json'),
      'utf8',
    ));
    const entry = manifest.adaptive_optimizer.functions.find(({ name }) => name === '$entry');
    assert.ok(entry.strategies.includes('automatic-cpu-pair-selected'));

    child = spawn(artifact, [], { cwd: work, windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    let overlappingThreads = false;
    let previous = new Map();
    for (let attempt = 0; attempt < 8 && child.exitCode === null; ++attempt) {
      const current = windowsThreadTimes(child.pid);
      const advancing = current.filter(({ id, ticks }) =>
        previous.has(id) && ticks > previous.get(id));
      overlappingThreads = advancing.length >= 2;
      if (overlappingThreads) break;
      previous = new Map(current.map(({ id, ticks }) => [id, ticks]));
    }
    const [status] = await once(child, 'close');
    assert.equal(status, 0, stderr);
    assert.equal(
      overlappingThreads,
      true,
      'selected artifact never exposed two CPU-active demand threads',
    );
    assert.deepEqual(stdout.trim().split(/\r?\n/u), [
      String(iterations),
      String(iterations * 2),
    ]);
  } finally {
    if (child && child.exitCode === null) {
      child.kill();
      await once(child, 'close').catch(() => {});
    }
    rmSync(work, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
});
