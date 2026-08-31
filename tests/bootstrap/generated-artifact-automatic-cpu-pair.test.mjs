import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
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
    timeout: 60_000,
    windowsHide: true,
    ...options,
  });
  assert.equal(result.error, undefined, result.error?.message);
  return result;
}

function compileDemandPair({ maxCores, iterations, stem }) {
  assert.equal(existsSync(compiler), true, 'configured VKF compiler does not exist');
  mkdirSync(configuredWorkRoot, { recursive: true });
  const work = mkdtempSync(join(configuredWorkRoot, `i54-${stem}-`));
  try {
    const source = join(work, `${stem}.vkf`);
    const artifact = join(work, `${stem}${suffix}`);
    writeFileSync(source, [
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
    ].join('\n'), 'utf8');

    const compiled = run(compiler, ['-b', source, '-o', artifact, '--diagnostics']);
    assert.equal(compiled.status, 0, `${compiled.stdout}\n${compiled.stderr}`);
    assert.equal(existsSync(artifact), true, 'compiler emitted no artifact');
    const manifest = JSON.parse(readFileSync(
      join(work, '.vkfbuild', stem, 'x64-manifest.json'),
      'utf8',
    ));
    const entry = manifest.adaptive_optimizer.functions.find(({ name }) => name === '$entry');
    assert.ok(entry, 'optimizer manifest omitted the entry function');
    const executed = run(artifact, [], { cwd: work });
    assert.equal(executed.status, 0, `${executed.stdout}\n${executed.stderr}`);
    assert.deepEqual(
      executed.stdout.trim().split(/\r?\n/u),
      [String(iterations), String(iterations * 2)],
    );
    return entry;
  } finally {
    rmSync(work, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
}

test('a compiled pure worthwhile demand pair selects the private CPU strategy in source order', {
  skip: compiler ? false : 'VKF_AUTOMATIC_CPU_COMPILER is not configured',
}, () => {
  const entry = compileDemandPair({ maxCores: 2, iterations: 1_048_576, stem: 'pair' });
  assert.ok(
    entry.strategies.includes('automatic-cpu-pair-selected'),
    `optimizer did not select the source demand pair: ${JSON.stringify(entry.strategies)}`,
  );
});

test('the generated-artifact selector preserves the process core ceiling', {
  skip: compiler ? false : 'VKF_AUTOMATIC_CPU_COMPILER is not configured',
}, () => {
  const entry = compileDemandPair({ maxCores: 1, iterations: 1_048_576, stem: 'single-core' });
  assert.equal(entry.strategies.includes('automatic-cpu-pair-selected'), false);
});

test('the generated-artifact selector keeps small demand pairs serial', {
  skip: compiler ? false : 'VKF_AUTOMATIC_CPU_COMPILER is not configured',
}, () => {
  const entry = compileDemandPair({ maxCores: 2, iterations: 16, stem: 'small-pair' });
  assert.equal(entry.strategies.includes('automatic-cpu-pair-selected'), false);
});
