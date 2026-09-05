import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {createSharedCompiler} from '../../web/playground/vkf-shared-compiler.mjs';
import {compareNativeOutput} from './shared-native-output.mjs';

test('ordinary functions lift through the current edited vector arguments', async () => {
  const module = new WebAssembly.Module(await readFile(new URL('../../build/shared-compiler/vkf-compiler.wasm', import.meta.url)));
  assert.deepEqual(WebAssembly.Module.imports(module), []);
  const compiler = createSharedCompiler({instance: new WebAssembly.Instance(module)});
  const source = await readFile(new URL('../../examples/introduction/vector-functions.vkf', import.meta.url), 'utf8');
  compareNativeOutput(compiler, source, '[2, 4, 6]\n[[2, 4], [6, 8]]\n');
  compareNativeOutput(compiler, source.replace('* 2', '* 3').replace('[1, 2, 3]', '[1, 2, 7]'),
    '[3, 6, 21]\n[[3, 6], [9, 12]]\n');
});
