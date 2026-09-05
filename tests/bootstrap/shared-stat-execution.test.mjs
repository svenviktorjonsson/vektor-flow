import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {createSharedCompiler} from '../../web/playground/vkf-shared-compiler.mjs';
import {compareNativeOutput} from './shared-native-output.mjs';

const module = new WebAssembly.Module(await readFile(new URL('../../build/shared-compiler/vkf-compiler.wasm', import.meta.url)));
assert.deepEqual(WebAssembly.Module.imports(module), []);
for (const [file, expected] of [
  ['stdlib/02-stat.vkf', '5\n4\n2\n7\n21\n[5, 7, 9]\n[6, 15]\n'],
  ['core/22-variadics-spreads.vkf', '10\n7\n(flag:true, mode:fast)\n'],
  ['core/28-structural-records.vkf', '[3, 7, 11]\n'],
]) {
  test(`the complete canonical ${file} executes through the shared compiler`, async () => {
    const compiler=createSharedCompiler({instance:new WebAssembly.Instance(module)});
    const source=await readFile(new URL(`../../examples/generated/readme/${file}`,import.meta.url),'utf8');
    compareNativeOutput(compiler, source, expected);
  });
}

test('stat axes and ddof retain their native values and exact diagnostics', () => {
  const compiler=createSharedCompiler({instance:new WebAssembly.Instance(module)});
  compareNativeOutput(compiler, ':: stat.sum([[1,2,3],[4,5,6]],axis:-1)\n:: stat.sum([[1,2,3],[4,5,6]],axis:(0,1))\n', '[6, 15]\n21\n');
  compareNativeOutput(compiler, ':: stat.variance([2,4,4,4,5,5,7,9],ddof:1)\n');
  compareNativeOutput(compiler, `(stat.variance([2,4,4,4,5,5,7,9],ddof:1) == ${32/7})?!\n`, '');
  for(const [source,message] of [
    [':: stat.std([1,2],ddof:2)\n','stat.std input is too small for ddof'],
    [':: stat.variance([1,2],ddof:0.5)\n','stat.variance ddof must be a non-negative integer constant'],
    [':: stat.sum([[1,2],[3,4]],axis:2)\n','stat.sum axis is out of range for rank 2'],
    [':: stat.sum([[1,2],[3,4]],axis:(0,0))\n','stat.sum axis tuple contains a duplicate axis'],
  ]) assert.throws(()=>compiler.run(source),error=>error.message===message,source);
});

test('dynamic empty sum/count remain valid native programs', () => {
  const compiler=createSharedCompiler({instance:new WebAssembly.Instance(module)});
  compareNativeOutput(compiler, ':: stat.sum(collections.list())\n:: stat.count(collections.list())\n', '0\n0\n');
});
