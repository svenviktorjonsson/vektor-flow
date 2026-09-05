import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {createSharedCompiler} from '../../web/playground/vkf-shared-compiler.mjs';
import {compareNativeOutput} from './shared-native-output.mjs';

const module = new WebAssembly.Module(await readFile(new URL('../../build/shared-compiler/vkf-compiler.wasm', import.meta.url)));
const compiler = createSharedCompiler({instance: new WebAssembly.Instance(module)});

test('WASM runs the native-discovered test source with its original assertion', () => {
  const source = 'answer() -> bit: (6 * 7 = 42)?!\n';
  const suite = compiler.describeTests(source, 'tests/vkf/probe.vkf');
  assert.equal(suite.expectedCompileError, null);
  assert.deepEqual(suite.tests.map(test => test.name), ['answer']);
  assert.equal(suite.tests[0].source, source + '(answer())?!\n');
  compareNativeOutput(compiler, suite.tests[0].source, '');
  assert.throws(() => compiler.run(suite.tests[0].source.replace('= 42', '= 41')));
});

test('expected compile errors retain the same native marker even when the source cannot parse', () => {
  const suite = compiler.describeTests('# expect-compile-error: expected token\nvalue: (\n');
  assert.equal(suite.expectedCompileError, 'expected token');
  assert.deepEqual(suite.tests, []);
});

test('native source selection includes every regular VKF test except native build artifacts', () => {
  assert.deepEqual(compiler.selectTestFiles(['tests/vkf/z.vkf', 'tests/vkf/.vkfbuild/generated.vkf',
    'tests/vkf/a.vkf', 'tests/vkf/readme.md']), ['tests/vkf/a.vkf', 'tests/vkf/z.vkf']);
});
