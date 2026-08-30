import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';

const compiler = process.env.VKF_PROCESS_LIMITS_COMPILER;
const configuredWorkRoot = resolve(process.env.VKF_TEST_WORK_ROOT ?? join(import.meta.dirname, '.work'));
const suffix = process.platform === 'win32' ? '.exe' : '';

test('public process limits bind conservative native optimizer ceilings', {
  skip: compiler ? false : 'VKF_PROCESS_LIMITS_COMPILER is not configured',
}, () => {
  assert.equal(existsSync(compiler), true, 'configured VKF compiler does not exist');
  mkdirSync(configuredWorkRoot, { recursive: true });
  const work = mkdtempSync(join(configuredWorkRoot, 'i48-process-limits-'));
  try {
    const source = join(work, 'configured.vkf');
    const artifact = join(work, `configured${suffix}`);
    writeFileSync(source, [
      'process.max_cores: 2',
      'process.enable_gpu: false',
      ':: 7',
    ].join('\n'), 'utf8');

    const compiled = spawnSync(compiler, ['-b', source, '-o', artifact, '--diagnostics'], {
      encoding: 'utf8',
      timeout: 60_000,
      windowsHide: true,
    });
    assert.equal(compiled.error, undefined, compiled.error?.message);
    assert.equal(compiled.status, 0, `${compiled.stdout}\n${compiled.stderr}`);
    assert.equal(existsSync(artifact), true, 'process-limited build emitted no artifact');

    const executed = spawnSync(artifact, [], {
      cwd: work,
      encoding: 'utf8',
      timeout: 60_000,
      windowsHide: true,
    });
    assert.equal(executed.error, undefined, executed.error?.message);
    assert.equal(executed.status, 0, `${executed.stdout}\n${executed.stderr}`);
    assert.equal(executed.stdout.trim(), '7');

    const typed = JSON.parse(readFileSync(
      join(work, '.vkfbuild', 'configured', 'typed-ir.json'),
      'utf8',
    ));
    assert.deepEqual(typed.process_limits, { enable_gpu: false, max_cores: 2 });
    const manifest = JSON.parse(readFileSync(
      join(work, '.vkfbuild', 'configured', 'x64-manifest.json'),
      'utf8',
    ));
    assert.equal(manifest.automatic_flow_limits.max_cores, 2);
    assert.ok(manifest.automatic_flow_limits.cpu_partition_limit >= 1);
    assert.ok(manifest.automatic_flow_limits.cpu_partition_limit <= 2);
    assert.equal(manifest.automatic_flow_limits.enable_gpu, false);
  } finally {
    rmSync(work, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
});

test('omitted process limits preserve automatic CPU selection and GPU permission', {
  skip: compiler ? false : 'VKF_PROCESS_LIMITS_COMPILER is not configured',
}, () => {
  mkdirSync(configuredWorkRoot, { recursive: true });
  const work = mkdtempSync(join(configuredWorkRoot, 'i48-process-auto-'));
  try {
    const source = join(work, 'automatic.vkf');
    const artifact = join(work, `automatic${suffix}`);
    writeFileSync(source, ':: 11\n', 'utf8');
    const compiled = spawnSync(compiler, ['-b', source, '-o', artifact, '--diagnostics'], {
      encoding: 'utf8',
      timeout: 60_000,
      windowsHide: true,
    });
    assert.equal(compiled.error, undefined, compiled.error?.message);
    assert.equal(compiled.status, 0, `${compiled.stdout}\n${compiled.stderr}`);
    const manifest = JSON.parse(readFileSync(
      join(work, '.vkfbuild', 'automatic', 'x64-manifest.json'),
      'utf8',
    ));
    const typed = JSON.parse(readFileSync(
      join(work, '.vkfbuild', 'automatic', 'typed-ir.json'),
      'utf8',
    ));
    assert.equal(Object.hasOwn(typed, 'process_limits'), false);
    assert.equal(manifest.automatic_flow_limits.max_cores, null);
    assert.ok(manifest.automatic_flow_limits.cpu_partition_limit >= 1);
    assert.equal(manifest.automatic_flow_limits.enable_gpu, true);
  } finally {
    rmSync(work, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
});

test('process limits reject unsafe or dynamic settings before artifact emission', {
  skip: compiler ? false : 'VKF_PROCESS_LIMITS_COMPILER is not configured',
}, () => {
  mkdirSync(configuredWorkRoot, { recursive: true });
  const work = mkdtempSync(join(configuredWorkRoot, 'i48-process-invalid-'));
  try {
    const cases = [
      ['zero', 'process.max_cores: 0\n:: 1\n', /positive constant int/],
      ['fraction', 'process.max_cores: 1.5\n:: 1\n', /positive constant int/],
      ['dynamic', 'limit: 2\nprocess.max_cores: limit\n:: 1\n', /compile-time constant/],
      ['gpu-num', 'process.enable_gpu: 1\n:: 1\n', /constant bit/],
      ['unknown', 'process.workers: 2\n:: 1\n', /unknown process setting workers/],
      [
        'duplicate',
        'process.max_cores: 2\nprocess.max_cores: 3\n:: 1\n',
        /duplicate process setting max_cores/,
      ],
    ];
    for (const [name, text, diagnostic] of cases) {
      const source = join(work, `${name}.vkf`);
      const artifact = join(work, `${name}${suffix}`);
      writeFileSync(source, text, 'utf8');
      const compiled = spawnSync(compiler, ['-b', source, '-o', artifact, '--diagnostics'], {
        encoding: 'utf8',
        timeout: 60_000,
        windowsHide: true,
      });
      assert.equal(compiled.error, undefined, `${name}: ${compiled.error?.message}`);
      assert.notEqual(compiled.status, 0, `${name} unexpectedly compiled`);
      assert.match(`${compiled.stdout}\n${compiled.stderr}`, diagnostic, name);
      assert.equal(existsSync(artifact), false, `${name} emitted an artifact`);
    }
  } finally {
    rmSync(work, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
});
