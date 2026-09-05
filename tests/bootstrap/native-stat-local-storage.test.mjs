import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp,writeFile} from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../../',import.meta.url));
const build=await mkdtemp(path.join(root,'build/native-stat-storage-'));
const cpp=path.join(build,'probe.cpp'), executable=path.join(build,'probe');
await writeFile(cpp,String.raw`
#include "compiler/native/vkf_machine_ir_lowering.hpp"
#include <iostream>
int main() {
 using namespace vkf::machine_ir;
 for(auto opcode : {Opcode::SumF64Locals,Opcode::MeanF64Locals,Opcode::VarianceF64Locals,Opcode::StdDevF64Locals,Opcode::RangeF64Locals}) {
   Function function;
   function.locals={"spare","value"}; function.local_classes={ValueClass::F64,ValueClass::F64};
   Instruction value; value.opcode=Opcode::PushF64; value.f64=7;
   Instruction store; store.opcode=Opcode::StoreLocal; store.index=1;
   Instruction reduce; reduce.opcode=opcode; reduce.index=1; reduce.argument_count=1;
   function.instructions={value,store,reduce};
   propagate_constant_numeric_locals(function);
   std::cout << function.instructions.size() << '\n';
   function.parameters={"source"}; function.locals={"source","copy"};
   function.local_classes={ValueClass::F64,ValueClass::F64};
   Instruction load; load.opcode=Opcode::LoadLocal; load.index=0;
   store.index=1; reduce.index=1;
   function.instructions={load,store,reduce};
   coalesce_scalar_local_copies(function);
   std::cout << function.instructions.size() << '\n';
 }
}
`);
test('constant propagation and copy coalescing retain storage read by all numeric local reductions',()=>{
  const compiled=spawnSync(process.env.CXX??'g++',['-std=c++17','-O0',`-I${root}`,`-I${path.join(root,'native/VfOverlay')}`,cpp,'-o',executable],
    {encoding:'utf8',timeout:120_000});
  assert.equal(compiled.status,0,compiled.stderr);
  const result=spawnSync(executable,[],{encoding:'utf8',timeout:30_000});
  assert.equal(result.status,0,result.stderr);
  assert.deepEqual(result.stdout.trim().split('\n').map(Number),Array(10).fill(3));
});
