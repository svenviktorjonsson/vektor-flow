import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {createSharedCompiler} from '../../web/playground/vkf-shared-compiler.mjs';

const module = new WebAssembly.Module(await readFile(new URL('../../build/shared-compiler/vkf-compiler.wasm', import.meta.url)));
const compiler = createSharedCompiler({instance: new WebAssembly.Instance(module)});
const nativePath = process.env.VKF_NATIVE_COMPILER ?? fileURLToPath(new URL('../../build/native-compiler-docker/bin/vkf-strict', import.meta.url));

function compare(source, identity = source, expectedStdout) {
  const directory = mkdtempSync(join(tmpdir(), 'vkf-scope-parity-'));
  try {
    const sourcePath = join(directory, 'case.vkf');
    writeFileSync(sourcePath, source);
    const native = spawnSync(nativePath, [sourcePath, '-o', join(directory, 'native-case')], {encoding: 'utf8', timeout: 30_000, windowsHide: true});
    assert.equal(native.error, undefined, native.error?.message);
    assert.equal(native.status, 0, native.stderr);
    if (expectedStdout !== undefined) assert.equal(native.stdout, expectedStdout, 'native lexical initializer result');
    const actual = compiler.run(source);
    assert.equal(actual.stdout, native.stdout, source);
    assert.equal(actual.stderr, native.stderr, source);
    assert.equal(compiler.run(source).stdout, native.stdout, 'fresh execution preserves lexical scope');
  } catch (error) {
    error.message = `${identity}: ${error.message}`;
    throw error;
  } finally {
    rmSync(directory, {recursive: true, force: true});
  }
}

test('scope identity returns current lexical fields, nested records and defaulted parameters', () => {
  for (const source of [
    'make_base(x:int, y:int): :\nbase: make_base(3, 4)\n:: base.x\n:: base.y\n',
    'make_base(x:int, y:int=4): :\nbase: make_base(3)\n:: base.x\n:: base.y\n',
    'outer: 3\nsnapshot:\n    inner: 7\n    :\n:: snapshot.outer\n:: snapshot.inner\n',
    'snapshot:\n    labels: ["left", "right"]\n    point: (x:3, y:4)\n    :\n:: snapshot.labels.1\n:: snapshot.point.y\n',
    'snapshot:\n    x: 3\n    .x: 7\n    :\n:: snapshot.x\n',
  ]) compare(source);
});

test('nested block declarations shadow without escaping and evaluate initializers in the original scope', () => {
  compare('value: 3\nnested:\n    value: value + 1\n    :: value\n    value + 1\n:: value\n:: nested\n', 'shadow initializer', '4\n3\n5\n');
  compare('value: "left"\nnested:\n    value: value & " right"\n    value\n:: value\n:: nested\n', 'owned string shadow initializer', 'left\nleft right\n');
  compare('value: 3\nsnapshot:\n    value: 4\n    nested:\n        value: 5\n        :\n    :: nested.value\n    :\n:: snapshot.value\n:: value\n');
});

test('all canonical native block tests run unchanged with their original assertions', async context => {
  const source = await readFile(new URL('../vkf/blocks.vkf', import.meta.url), 'utf8');
  const suite = compiler.describeTests(source, 'tests/vkf/blocks.vkf');
  assert.equal(suite.expectedCompileError, null);
  assert.equal(suite.tests.length, 14);
  for (const entry of suite.tests) {
    await context.test(entry.name, () => compare(entry.source, `tests/vkf/blocks.vkf::${entry.name}`));
  }
});

test('canonical semicolon block and pipe example runs unchanged', async () => {
  compare(await readFile(new URL('../../examples/generated/readme/core/49-semicolon-pipes.vkf', import.meta.url), 'utf8'));
});

test('inferred record argument adaptation evaluates the argument producer exactly once', () => {
  compare(`sum_pair(pair:any) -> num: pair.0 + pair.1
sum_record(value:any) -> num: sum_pair(value.pair)
samples() -> [int:2]:
    :: 99
    [2,3]
:: sum_record((pair:samples()))
`, 'record argument evaluated once', '99\n5\n');
});

test('record layout inference uses canonical source alongside output and linked math', () => {
  compare(`math: .math
sum_pair(pair:any) -> num: pair.0 + pair.1
sum_record(value:any) -> num: sum_pair(value.pair)
:: sum_record((pair:[2,3]))
:: math.sqrt(9)
`, 'record inference with linked math', '5\n3\n');
});
