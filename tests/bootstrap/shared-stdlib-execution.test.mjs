import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {createSharedCompiler} from '../../web/playground/vkf-shared-compiler.mjs';
import {compareNativeOutput} from './shared-native-output.mjs';

test('the browser links and executes the same source-defined math functions as native', async () => {
  const module = new WebAssembly.Module(await readFile(new URL('../../build/shared-compiler/vkf-compiler.wasm', import.meta.url)));
  assert.deepEqual(WebAssembly.Module.imports(module), []);
  const compiler = createSharedCompiler({instance: new WebAssembly.Instance(module)});
  compareNativeOutput(compiler, 'math: .math\n:: math.log(8, 2)\n', '3\n');
  compareNativeOutput(compiler, 'math: .math\n:: math.log(16, 2)\n', '4\n');
});
