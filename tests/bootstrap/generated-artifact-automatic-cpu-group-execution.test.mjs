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

function sourceFor(iterations) {
  const source = ['process.max_cores: 4'];
  for (let lane = 0; lane < 4; ++lane) {
    source.push(
      `lane_${lane}() -> int:`,
      '    i: 0',
      `    value: ${lane + 1}`,
      `    i < ${iterations}?>`,
      '        .value: value + 1',
      '        .i: i + 1',
      '    @: value',
    );
  }
  for (let lane = 0; lane < 4; ++lane) source.push(`result_${lane}: lane_${lane}()`);
  for (let lane = 0; lane < 4; ++lane) source.push(`:: result_${lane}`);
  return source.join('\n');
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

test('a selected four-demand group executes on four overlapping OS threads', {
  skip: process.platform === 'win32' && compiler
    ? false
    : 'Windows generated-artifact compiler is not configured',
  timeout: 180_000,
}, async () => {
  assert.equal(existsSync(compiler), true, 'configured VKF compiler does not exist');
  mkdirSync(configuredWorkRoot, { recursive: true });
  const work = mkdtempSync(join(configuredWorkRoot, 'i85-overlap-'));
  let child = null;
  try {
    const iterations = 500_000_000;
    const source = join(work, 'overlap.vkf');
    const artifact = join(work, `overlap${suffix}`);
    writeFileSync(source, sourceFor(iterations), 'utf8');
    const compiled = run(compiler, ['-b', source, '-o', artifact, '--diagnostics']);
    assert.equal(compiled.status, 0, `${compiled.stdout}\n${compiled.stderr}`);
    const manifest = JSON.parse(readFileSync(
      join(work, '.vkfbuild', 'overlap', 'x64-manifest.json'),
      'utf8',
    ));
    const entry = manifest.adaptive_optimizer.functions.find(({ name }) => name === '$entry');
    assert.ok(entry.strategies.includes('automatic-cpu-group-selected'));

    child = spawn(artifact, [], { cwd: work, windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    let maximumAdvancingThreads = 0;
    let previous = new Map();
    for (let attempt = 0; attempt < 16 && child.exitCode === null; ++attempt) {
      const current = windowsThreadTimes(child.pid);
      const advancing = current.filter(({ id, ticks }) =>
        previous.has(id) && ticks > previous.get(id));
      maximumAdvancingThreads = Math.max(maximumAdvancingThreads, advancing.length);
      if (maximumAdvancingThreads >= 4) break;
      previous = new Map(current.map(({ id, ticks }) => [id, ticks]));
    }
    const [status] = await once(child, 'close');
    assert.equal(status, 0, stderr);
    assert.equal(
      maximumAdvancingThreads >= 4,
      true,
      `selected group exposed only ${maximumAdvancingThreads} CPU-active threads`,
    );
    assert.deepEqual(
      stdout.trim().split(/\r?\n/u),
      Array.from({ length: 4 }, (_, lane) => String(iterations + lane + 1)),
    );
  } finally {
    if (child && child.exitCode === null) {
      child.kill();
      await once(child, 'close').catch(() => {});
    }
    rmSync(work, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
});
