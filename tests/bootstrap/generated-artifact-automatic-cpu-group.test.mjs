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
    timeout: 120_000,
    windowsHide: true,
    ...options,
  });
  assert.equal(result.error, undefined, result.error?.message);
  return result;
}

function laneSource(lane, iterations) {
  const increment = 101 + lane * 18;
  return [
    `lane_${lane}() -> int:`,
    '    i: 0',
    `    value: ${lane + 1}`,
    `    i < ${iterations}?>`,
    `        .value: (value * 75 + ${increment}) % 65521`,
    '        .i: i + 1',
    '    @: value',
  ];
}

function sourceFor(iterations) {
  const source = ['process.max_cores: 4'];
  for (let lane = 0; lane < 4; ++lane) source.push(...laneSource(lane, iterations));
  for (let lane = 0; lane < 4; ++lane) source.push(`result_${lane}: lane_${lane}()`);
  for (let lane = 0; lane < 4; ++lane) source.push(`:: result_${lane}`);
  return source.join('\n');
}

function expectedValues(iterations) {
  const values = [];
  for (let lane = 0; lane < 4; ++lane) {
    let value = lane + 1;
    const increment = 101 + lane * 18;
    for (let i = 0; i < iterations; ++i) value = (value * 75 + increment) % 65521;
    values.push(String(value));
  }
  return values;
}

test('one compiled pure integer workload selects four private CPU lanes and retains source order', {
  skip: process.platform === 'win32' && compiler
    ? false
    : 'Windows generated-artifact compiler is not configured',
  timeout: 180_000,
}, () => {
  assert.equal(existsSync(compiler), true, 'configured VKF compiler does not exist');
  mkdirSync(configuredWorkRoot, { recursive: true });
  const work = mkdtempSync(join(configuredWorkRoot, 'i84-group-'));
  try {
    const iterations = 1_048_576;
    const source = join(work, 'group.vkf');
    const artifact = join(work, `group${suffix}`);
    writeFileSync(source, sourceFor(iterations), 'utf8');
    const compiled = run(compiler, ['-b', source, '-o', artifact, '--diagnostics']);
    assert.equal(compiled.status, 0, `${compiled.stdout}\n${compiled.stderr}`);
    const manifest = JSON.parse(readFileSync(
      join(work, '.vkfbuild', 'group', 'x64-manifest.json'),
      'utf8',
    ));
    const entry = manifest.adaptive_optimizer.functions.find(({ name }) => name === '$entry');
    assert.ok(entry, 'optimizer manifest omitted the entry function');
    assert.ok(
      entry.strategies.includes('automatic-cpu-group-selected'),
      `optimizer did not select the four-way source demand group: ${JSON.stringify(entry.strategies)}`,
    );
    const executed = run(artifact, [], { cwd: work });
    assert.equal(executed.status, 0, `${executed.stdout}\n${executed.stderr}`);
    assert.deepEqual(executed.stdout.trim().split(/\r?\n/u), expectedValues(iterations));
  } finally {
    rmSync(work, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
});
