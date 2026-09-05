import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {createSharedCompiler} from '../../web/playground/vkf-shared-compiler.mjs';
import {compareNativeOutput} from './shared-native-output.mjs';

const module = new WebAssembly.Module(await readFile(new URL('../../build/shared-compiler/vkf-compiler.wasm', import.meta.url)));
const compiler = createSharedCompiler({instance: new WebAssembly.Instance(module)});

test('ordinary native scalar math builtins execute without an explicit module import', () => {
  compareNativeOutput(compiler, ':: sqrt(25)\n:: abs(-3)\n:: sin(0)\n:: cos(0)\n:: exp(0)\n:: ln(1)\n',
    '5\n3\n0\n1\n1\n0\n');
});

test('a declared function retains precedence over a same-named math builtin', () => {
  compareNativeOutput(compiler, 'sqrt(value:num) -> num: value + 10\n:: sqrt(25)\n', '35\n');
});
