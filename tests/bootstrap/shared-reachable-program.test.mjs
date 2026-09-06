import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

import {runInlineWorkerRequest} from '../../web/inline-runner-worker.mjs';

test('unchanged random guide omits unreachable clock capability functions',async()=>{
  const [wasm,source]=await Promise.all([
    readFile(new URL('../../build/shared-compiler/vkf-compiler.wasm',import.meta.url)),
    readFile(new URL('../../examples/generated/readme/stdlib/03-random.vkf',import.meta.url),'utf8'),
  ]);
  const module=new WebAssembly.Module(wasm);
  assert.deepEqual(WebAssembly.Module.imports(module),[]);
  assert.deepEqual(runInlineWorkerRequest({type:'run',id:1,source,module}),{
    id:1,status:'ok',output:{
      kind:'console',
      stdout:'0.009626434189093501\n1.791479416094478\n',
      stderr:'',
    },
  });
});
