import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

import {runInlineWorkerRequest} from '../../web/inline-runner-worker.mjs';

const canonical=`value: 3
num scaled: value * 2
.value: value + 4
:: value
:: scaled
`;

test('actual inline worker runs edited guide source through the shared compiler WASM',async()=>{
  const bytes=await readFile(new URL('../../build/shared-compiler/vkf-compiler.wasm',import.meta.url));
  const module=new WebAssembly.Module(bytes);
  assert.deepEqual(WebAssembly.Module.imports(module),[]);
  const run=(source,id)=>runInlineWorkerRequest({type:'run',id,source,module});
  assert.deepEqual(await run(canonical,1),{
    id:1,status:'ok',output:{kind:'console',stdout:'7\n6\n',stderr:''},
  });
  assert.deepEqual(await run(canonical.replace('value: 3','value: 5'),2),{
    id:2,status:'ok',output:{kind:'console',stdout:'9\n10\n',stderr:''},
  });
  assert.deepEqual(await run(canonical,3),{
    id:3,status:'ok',output:{kind:'console',stdout:'7\n6\n',stderr:''},
  });
});
