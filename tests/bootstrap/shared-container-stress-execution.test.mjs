import {readFile} from 'node:fs/promises';
import test from 'node:test';

import {createSharedCompiler} from '../../web/playground/vkf-shared-compiler.mjs';
import {compareNativeOutput} from './shared-native-output.mjs';

const module=new WebAssembly.Module(await readFile(
  new URL('../../build/shared-compiler/vkf-compiler.wasm',import.meta.url)));
const compiler=createSharedCompiler({instance:new WebAssembly.Instance(module)});

test('README container stress reuses fixed compound-update storage',()=>{
  compareNativeOutput(compiler,`container_work(n:int) -> int:
    values: [1, 2, 3, 4]
    delta: [1, 2, 3, 4]
    checksum: 0
    n > 0?
        ..n - 1 >>
            .values +: delta
            .values -: delta
            .checksum+: values.0 + values.1 + values.2 + values.3
    checksum

:: container_work(1000000)
`,'10000000\n');
});
