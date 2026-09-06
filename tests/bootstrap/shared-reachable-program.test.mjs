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

test('unchanged primitive guide executes compiler-owned scalar conversions',async()=>{
  const [wasm,source]=await Promise.all([
    readFile(new URL('../../build/shared-compiler/vkf-compiler.wasm',import.meta.url)),
    readFile(new URL('../../examples/generated/readme/core/06-primitives.vkf',import.meta.url),'utf8'),
  ]);
  const module=new WebAssembly.Module(wasm);
  assert.deepEqual(runInlineWorkerRequest({type:'run',id:2,source,module}),{
    id:2,status:'ok',output:{
      kind:'console',stdout:'true\nA\n1.5\n7\nnull\n',stderr:'',
    },
  });
});

test('unchanged literal-spread guide expands fixed items in the compiler',async()=>{
  const [wasm,source]=await Promise.all([
    readFile(new URL('../../build/shared-compiler/vkf-compiler.wasm',import.meta.url)),
    readFile(new URL('../../examples/generated/readme/core/22b-literal-spreads.vkf',import.meta.url),'utf8'),
  ]);
  const module=new WebAssembly.Module(wasm);
  assert.deepEqual(runInlineWorkerRequest({type:'run',id:3,source,module}),{
    id:3,status:'ok',output:{kind:'console',stdout:'(1, 2, 3, 4)\n4\n',stderr:''},
  });
});

test('unchanged indexing guide gathers and scatters selected lanes',async()=>{
  const [wasm,source]=await Promise.all([
    readFile(new URL('../../build/shared-compiler/vkf-compiler.wasm',import.meta.url)),
    readFile(new URL('../../examples/generated/readme/core/41-indexing.vkf',import.meta.url),'utf8'),
  ]);
  const module=new WebAssembly.Module(wasm);
  assert.deepEqual(runInlineWorkerRequest({type:'run',id:4,source,module}),{
    id:4,status:'ok',output:{
      kind:'console',stdout:'20\n[10, 30]\n[10, 21, 30, 41]\n',stderr:'',
    },
  });
});
