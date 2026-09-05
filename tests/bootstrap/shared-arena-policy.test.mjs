// RED-only policy evidence. This does not approve a new capacity or diagnostic.
// It compares the two existing emitter configurations without changing either.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
const root=fileURLToPath(new URL('../../',import.meta.url));
const directory=await mkdtemp(path.join(root,'build/arena-policy-test-'));
const cpp=path.join(directory,'probe.cpp'),executable=path.join(directory,'probe');
await writeFile(cpp,String.raw`
#include "compiler/native/vkf_wasm_vm_emitter.hpp"
#include <fstream>
int main(int argc,char** argv) {
  vkf::wasm::bytecode::Module module;
  vkf::wasm::vm::EmitterOptions options;
  if(argc==3) options.arena_capacity=64U*1024U*1024U;
  const auto emitted=vkf::wasm::vm::emit(module,options);
  std::ofstream out(argv[1],std::ios::binary);
  out.write(reinterpret_cast<const char*>(emitted.wasm.data()),emitted.wasm.size());
}
`);
const build=spawnSync(process.env.CXX??'g++',['-std=c++17','-O0',`-I${root}`,cpp,'-o',executable],{encoding:'utf8',timeout:120000});
assert.equal(build.status,0,build.stderr);

test('existing browser-default and native-artifact allocation paths retain the same request outcome',async context=>{
  const observations=[];
  for(const [name,expected,extra] of [['browser-default',1024*1024,[]],['native-artifact',64*1024*1024,['--native-policy']]]) {
    const file=path.join(directory,name+'.wasm');
    const generated=spawnSync(executable,[file,...extra],{encoding:'utf8',timeout:30000});
    assert.equal(generated.status,0,generated.stderr);
    const module=new WebAssembly.Module(await readFile(file));
    assert.deepEqual(WebAssembly.Module.imports(module),[]);
    const api=new WebAssembly.Instance(module).exports;
    const capacity=api.vkf_vm_heap_limit()-api.vkf_vm_heap_base();
    assert.equal(capacity,expected,'this audit must measure the existing policies');
    const requests=[capacity-1,capacity,capacity+1,2*1024*1024];
    const outcomes=requests.map(bytes=>{
      api.vkf_vm_reset();
      const before=api.vkf_vm_heap_ptr();
      try {
        const pointer=api.vkf_vm_alloc(bytes);
        return {bytes,ok:true,allocated:api.vkf_vm_heap_ptr()-before,pointer};
      } catch(error) {
        assert.equal(api.vkf_vm_heap_ptr(),before,'failed allocation must not advance the arena');
        return {bytes,ok:false,errorName:error.name,errorMessage:error.message};
      }
    });
    observations.push({name,capacity,memoryBytes:api.memory.buffer.byteLength,outcomes});
  }
  await writeFile(path.join(directory,'observations.json'),JSON.stringify(observations,null,2));
  context.diagnostic(JSON.stringify({directory,observations}));
  // Preserve this discrepancy as RED pending an explicit resource-policy choice.
  // Do not green it by changing the fixture, filtering a path or raising capacity.
  assert.equal(observations[0].outcomes[3].ok,observations[1].outcomes[3].ok,
    'the same 2 MiB allocation traps with browser defaults but succeeds with native-artifact settings');
});
