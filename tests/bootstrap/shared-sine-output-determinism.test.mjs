import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {createSharedCompiler} from '../../web/playground/vkf-shared-compiler.mjs';
import {compareNativeOutput} from './shared-native-output.mjs';

// Separate exact-output RED. The original <= 1e-12 sample checks remain in
// shared-vector-arithmetic.test.mjs and execute inside VKF, unchanged in strength.
test('all 101 sine samples have byte-identical native and WASM console output', async () => {
  const module = new WebAssembly.Module(await readFile(new URL('../../build/shared-compiler/vkf-compiler.wasm', import.meta.url)));
  const compiler = createSharedCompiler({instance:new WebAssembly.Instance(module)});
  compareNativeOutput(compiler, ':.math\nx: 0.1[..100]\n:: sin(x)\n');
});
