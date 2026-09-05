import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {createSharedCompiler} from '../../web/playground/vkf-shared-compiler.mjs';

const beforeBytes=await readFile(new URL('../../build/trig-pre-switch-789211d7/build/shared-compiler/vkf-compiler.wasm',import.meta.url));
assert.equal(createHash('sha256').update(beforeBytes).digest('hex'),'ef5a91b822ebb5ccfbbf751331bec00beb73f45de874c880303447b84a5d2548');
const afterBytes=await readFile(new URL('../../build/shared-compiler/vkf-compiler.wasm',import.meta.url));
function host(bytes){
  const module=new WebAssembly.Module(bytes),instance=new WebAssembly.Instance(module);
  const compiler=createSharedCompiler({instance}),api=instance.exports;
  return {module,compiler,api};
}
const before=host(beforeBytes),after=host(afterBytes);
function emission(host,source){
  host.compiler.compile(source);
  assert.equal(host.api.vkf_emit_program(),0);
  const response=new Uint8Array(host.api.memory.buffer,host.api.vkf_result_pointer(),host.api.vkf_result_length()).slice();
  const program=new Uint8Array(host.api.memory.buffer,host.api.vkf_program_pointer(),host.api.vkf_program_length()).slice();
  return {response,program};
}
test('the math switch preserves exact non-math frontend, manifest, exports and console contracts',()=>{
  assert.deepEqual(WebAssembly.Module.exports(after.module),WebAssembly.Module.exports(before.module));
  assert.deepEqual(WebAssembly.Module.imports(after.module),[]);
  const sources=[
    ':: 42\n', ':: "VKF"\n', ':: true\n', ':: [1,2,3]\n',
    ':: (8,4)\n', ':: (x:1,label:"hi",nested:(enabled:true,samples:[2,3]))\n',
    'double(value:int)->int:value*2\n:: double([1,2,3])\n',
    'x:0.1[..100]\n:: x*2\n', ':: (2 >< 0)\n',
  ];
  for(const source of sources){
    assert.deepEqual(after.compiler.compile(source),before.compiler.compile(source),source);
    const old=emission(before,source),current=emission(after,source);
    assert.deepEqual(current.response,old.response,'exact serialized emission manifest');
    assert.deepEqual(WebAssembly.Module.exports(new WebAssembly.Module(current.program)),WebAssembly.Module.exports(new WebAssembly.Module(old.program)));
    assert.deepEqual(WebAssembly.Module.imports(new WebAssembly.Module(current.program)),[]);
    assert.deepEqual(after.compiler.run(source),before.compiler.run(source),source);
    // Runtime code/constants changed deliberately. Do not describe private
    // non-math executable byte identities as unchanged acceptance artifacts.
    assert.notEqual(createHash('sha256').update(current.program).digest('hex'),createHash('sha256').update(old.program).digest('hex'));
  }
});
