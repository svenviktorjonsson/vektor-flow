import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {createSharedCompiler} from '../../web/playground/vkf-shared-compiler.mjs';
import {compareNativeOutput} from './shared-native-output.mjs';

const module = new WebAssembly.Module(await readFile(new URL('../../build/shared-compiler/vkf-compiler.wasm', import.meta.url)));
const compiler = createSharedCompiler({instance: new WebAssembly.Instance(module)});

test('the unchanged native math alias test executes its nested-vector assertion in WASM', async () => {
  const source = await readFile(new URL('../vkf/math_alias.vkf', import.meta.url), 'utf8');
  const suite = compiler.describeTests(source, 'tests/vkf/math_alias.vkf');
  assert.equal(suite.tests.length, 1);
  compareNativeOutput(compiler, suite.tests[0].source, '');
});

test('source-defined two-argument math lifts scalar/vector arguments in either position', () => {
  const source = 'm: .math\n:: m.atan2([1.0, 0.0], 1)\n:: m.atan2(1, [1.0, 0.0])\n:: m.atan2([1.0, 0.0], [0.0, -1.0])\n';
  compareNativeOutput(compiler, source);
  const expected = [[Math.PI / 4, 0], [Math.PI / 4, Math.PI / 2], [Math.PI / 2, Math.PI]];
  let checked = 'm: .math\nr0: m.atan2([1.0, 0.0], 1)\nr1: m.atan2(1, [1.0, 0.0])\nr2: m.atan2([1.0, 0.0], [0.0, -1.0])\n';
  for (let row = 0; row < 3; ++row) checked += `(stat.count(r${row}) == 2)?!\n`;
  for (let row = 0; row < 3; ++row) for (let column = 0; column < 2; ++column) {
    checked += `(abs(r${row}.${column} - ${expected[row][column]}) < 0.000001)?!\n`;
  }
  compareNativeOutput(compiler, checked, '');
});
