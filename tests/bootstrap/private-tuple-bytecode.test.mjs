import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import test from 'node:test';
const root=fileURLToPath(new URL('../../',import.meta.url));
const directory=await mkdtemp(path.join(root,'build/private-tuple-bytecode-'));
const source=path.join(directory,'probe.cpp'),binary=path.join(directory,'probe');
await writeFile(source,String.raw`
#include "compiler/native/vkf_wasm_bytecode.hpp"
#include "compiler/native/vkf_wasm_value_layout.hpp"
#include <iostream>
int main() {
  using namespace vkf::wasm::bytecode;
  static_assert(static_cast<unsigned>(vkf::wasm::values::Tag::Array)==4);
  static_assert(static_cast<unsigned>(vkf::wasm::values::Tag::Record)==5);
  static_assert(static_cast<unsigned>(vkf::wasm::values::Tag::Tuple)==6);
  Module module;module.constants={Constant::utf8_string("probe"),Constant::number_value(3)};
  Function fn;fn.return_type=ValueType::Dynamic;
  fn.instructions={{Opcode::PushConstant,ValueType::Number,1},{Opcode::MakeTuple,ValueType::Dynamic,1},{Opcode::Return}};
  module.functions.push_back(fn);module.entry_function=0;
  auto bytes=serialize(module);
  if(bytes[8]!=3||bytes[9]!=0||!(deserialize(bytes)==module))return 1;
  bytes[8]=2;
  try{deserialize(bytes);return 2;}catch(const BytecodeError& error){
    if(std::string(error.what())!="private tuple opcode requires bytecode version 3")return 3;
  }
  bytes[8]=4;
  try{deserialize(bytes);return 4;}catch(const BytecodeError& error){
    if(std::string(error.what())!="unsupported bytecode version")return 5;
  }
  module.functions[0].instructions[1].opcode=Opcode::MakeArray;
  bytes=serialize(module);
  if(bytes[8]!=2||bytes[9]!=0||!(deserialize(bytes)==module))return 6;
  std::cout<<"private-v3 and legacy-v2 round trips; v2 tuple rejected\n";
}
`);
test('private tuple bytecode versions explicitly while legacy serialization stays v2',()=>{
  const built=spawnSync(process.env.CXX??'g++',['-std=c++17','-O0',`-I${root}`,source,'-o',binary],{encoding:'utf8',timeout:120000});
  assert.equal(built.status,0,built.stderr);
  const run=spawnSync(binary,[],{encoding:'utf8',timeout:30000});
  assert.equal(run.status,0,run.stderr);assert.equal(run.stdout,'private-v3 and legacy-v2 round trips; v2 tuple rejected\n');
});
