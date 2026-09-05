import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const compiler = process.env.VKF_NATIVE_COMPILER ?? fileURLToPath(new URL(
  '../../build/native-compiler-docker/bin/vkf-strict', import.meta.url));

function run(source) {
  const run = spawnSync(compiler, ['-e', source], { encoding: 'utf8', timeout: 30_000 });
  assert.equal(run.error, undefined, run.error?.message);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stderr, '');
  return run.stdout;
}

test('nested print effects commit before each enclosing top-level print', () => {
  const source = 'emit(value:num) -> num:\n    :: value\n    value + 1\n\n:: emit(2)\n:: emit(4)\n';
  assert.equal(run(source), '2\n3\n4\n5\n');
});

test('transitively called print effects preserve source order between top-level prints', () => {
  const source = 'emit(value:num) -> num:\n    :: value\n    value + 1\n\nouter(value:num) -> num: emit(value)\n\n:: 0\n:: outer(2)\n:: 9\n';
  assert.equal(run(source), '0\n2\n3\n9\n');
});

test('labelled output commits on stdout between ordinary prints', () => {
  assert.equal(run('value: 7\n:: 0\n::: value\n:: 9\n'), '0\nvalue: 7\n9\n');
});

test('print-free calls retain scalar and structured output behavior', () => {
  assert.equal(run('double(value:num) -> num: value * 2\n:: double(2)\n:: double(4)\n'), '4\n8\n');
  assert.equal(run(':: [1, 2, 3]\n:: true\n'), '[1, 2, 3]\ntrue\n');
});
