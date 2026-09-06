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
    id:3,status:'ok',output:{kind:'console',stdout:'[1, 2, 3, 4]\n4\n',stderr:''},
  });
});

for (const [id,example,stdout] of [
  [11,'35-pipes','[2, 4, 6]\n(11, 12, 13)\n16\nååAA\n'],
  [12,'36b-pipe-assignment','[4, 3, 2, 1]\n(40, 30, 20, 10)\n'],
]) {
  test(`unchanged ${example} guide preserves compiler-owned pipe result shape`,async()=>{
    const [wasm,source]=await Promise.all([
      readFile(new URL('../../build/shared-compiler/vkf-compiler.wasm',import.meta.url)),
      readFile(new URL(`../../examples/generated/readme/core/${example}.vkf`,import.meta.url),'utf8'),
    ]);
    const module=new WebAssembly.Module(wasm);
    assert.deepEqual(WebAssembly.Module.imports(module),[]);
    assert.deepEqual(runInlineWorkerRequest({type:'run',id,source,module}),{
      id,status:'ok',output:{kind:'console',stdout,stderr:''},
    });
  });
}

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

for (const [id,example,stdout] of [
  [5,'07-reflection','4\ntype\n[int:2]\nTypeScope(reflected:type)\n'],
  [6,'46-member-reflection','(x:int, y:int)\n[x, y]\n[x, y]\n{x:1, y:1}\n'],
  [7,'14-multisets','{a:7, b:1, c:2}\n{a:1, b:1}\n{a:2}\n{a:1}\n'],
  [8,'50-generic-types','vkf\n4\n[int:3]\n6\n'],
  [9,'49-nominal-constructors',
    'Point\n(x:num, y:num)\n(x:num, y:num)\ntype\n[x, y]\ntrue\n[int:3]\n(x:num, y:num)\ninteger\nnumber\n'],
]) {
  test(`unchanged ${example} guide executes reflected type descriptors`,async()=>{
    const [wasm,source]=await Promise.all([
      readFile(new URL('../../build/shared-compiler/vkf-compiler.wasm',import.meta.url)),
      readFile(new URL(`../../examples/generated/readme/core/${example}.vkf`,import.meta.url),'utf8'),
    ]);
    const module=new WebAssembly.Module(wasm);
    assert.deepEqual(WebAssembly.Module.imports(module),[]);
    assert.deepEqual(runInlineWorkerRequest({type:'run',id,source,module}),{
      id,status:'ok',output:{kind:'console',stdout,stderr:''},
    });
  });
}

test('unchanged linked-guide physics units execute as typed numeric values',async()=>{
  const wasm=await readFile(new URL('../../build/shared-compiler/vkf-compiler.wasm',import.meta.url));
  const module=new WebAssembly.Module(wasm);
  const source=`:.physics
:.physics.units

force: 2kg * 3m / 1s^2
normal: cross3([1, 0, 0], [0, 1, 0])

:: force / 1N
:: normal
`;
  assert.deepEqual(WebAssembly.Module.imports(module),[]);
  assert.deepEqual(runInlineWorkerRequest({type:'run',id:10,source,module}),{
    id:10,status:'ok',output:{kind:'console',stdout:'6\n[0, 0, 1]\n',stderr:''},
  });
});
