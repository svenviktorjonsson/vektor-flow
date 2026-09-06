import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const source=`: .ui.display
:.math
display:Display()
frame:display.add_frame(pos:[0.08,0.08],size:[0.84,0.84])
x:0.1[..100]
y:sin(x)
frame.add(x_u:x,y_u:y,id:"before",color:[0.12,0.72,1,1])
.y:y+1
frame.add(x_u:x,y_u:y,id:"after",color:[0.12,0.72,1,1])
`;
const orderedSource=`mark(label:int,values:[num:101])->[num:101]:
    :: label
    values
: .ui.display
:.math
display:Display()
frame:display.add_frame(pos:[0.08,0.08],size:[0.84,0.84])
x:0.1[..100]
y:sin(x)
frame.add(y_u:mark(1,y),x_u:mark(2,x),id:"ordered",color:[0.12,0.72,1,1])
`;
const conditionalSource=`: .ui.display
:.math
display:Display()
frame:display.add_frame(pos:[0.08,0.08],size:[0.84,0.84])
x:0.1[..100]
y:sin(x)
enabled:false
enabled? frame.add(x_u:x,y_u:y,id:"hidden",color:[0.12,0.72,1,1])
frame.add(x_u:x,y_u:y,id:"visible",color:[0.12,0.72,1,1])
`;
const aliasSource=`: .ui.display
:.math
display:Display()
frame:display.add_frame(pos:[0.08,0.08],size:[0.84,0.84])
x:0.1[..100]
y:sin(x)
alias:frame
alias.add(x_u:x,y_u:y,id:"once",color:[0.12,0.72,1,1])
`;
const mutationSource=`: .ui.display
:.math
display:Display()
frame:display.add_frame(pos:[0.08,0.08],size:[0.84,0.84])
x:0.1[..100]
y:sin(x)
frame.add(x_u:x,y_u:y,id:"before",color:[0.12,0.72,1,1])
y.(0):999
frame.add(x_u:x,y_u:y,id:"after",color:[0.12,0.72,1,1])
`;

test('runtime UI effects pack executed operand snapshots in source order',async()=>{
  const bytes=await readFile(new URL('../../build/shared-ui-probe/vkf-compiler.wasm',import.meta.url));
  const compiler=(await WebAssembly.instantiate(bytes)).instance.exports;
  compiler._initialize?.();
  assert.equal(typeof compiler.vkf_format_ui_packets,'function','private runtime packet extractor is missing');
  const encoded=new TextEncoder().encode(source);
  const sourcePointer=compiler.malloc(encoded.length);
  try{
    new Uint8Array(compiler.memory.buffer,sourcePointer,encoded.length).set(encoded);
    assert.equal(compiler.vkf_compile_source(sourcePointer,encoded.length),0,response(compiler).message);
    assert.equal(compiler.vkf_emit_program(),0,response(compiler).message);
    const emitted=response(compiler);
    const programBytes=new Uint8Array(compiler.memory.buffer,
      compiler.vkf_program_pointer(),compiler.vkf_program_length()).slice();
    const execute=async()=>{
      const program=(await WebAssembly.instantiate(programBytes)).instance.exports;
      assert.equal(program.vkf_vm_invoke(emitted.manifest.functions.$vkf_main.index,0),0);
      const used=Math.max(program.vkf_vm_heap_ptr(),
        program.vkf_vm_results_ptr()+program.vkf_vm_value_slot_size());
      const memory=new Uint8Array(program.memory.buffer,0,used);
      const pointer=compiler.malloc(memory.length);
      try{
        new Uint8Array(compiler.memory.buffer,pointer,memory.length).set(memory);
        assert.equal(compiler.vkf_format_stdout(pointer,memory.length,
          program.vkf_vm_results_ptr()),0);
        assert.equal(response(compiler).stdout,'','UI effects must not enter console output');
        assert.equal(compiler.vkf_format_ui_packets(pointer,memory.length,
          program.vkf_vm_results_ptr(),640,360),0);
        return response(compiler);
      }finally{compiler.free(pointer);}
    };
    const result=await execute();
    assert.equal(result.ok,true,result.message);
    assert.equal(result.packets.length,2);
    assert.deepEqual(result.packets.map(packet=>packet.layout.bounds.slice(0,2)),[[0,10],[0,10]]);
    assert.ok(Math.abs(result.packets[1].layout.bounds[2]-result.packets[0].layout.bounds[2]-1)<1e-12);
    assert.ok(Math.abs(result.packets[1].layout.bounds[3]-result.packets[0].layout.bounds[3]-1)<1e-12);
    assert.deepEqual(result.packets.map(packet=>packet.metadata.scene.meshes[1].id),['before','after']);
    assert.deepEqual(await execute(),result,'fresh executions must reset and reproduce packet bytes');
  }finally{compiler.free(sourcePointer);}
});

test('runtime UI operands execute once in authored order before packet capture',async()=>{
  const result=await executeOnce(orderedSource);
  assert.equal(result.stdout,'1\n2\n');
  assert.equal(result.packets.length,1);
  assert.equal(result.packets[0].metadata.scene.meshes[1].id,'ordered');
});

test('runtime UI effect remains inside its untaken condition',async()=>{
  const result=await executeOnce(conditionalSource);
  assert.equal(result.stdout,'');
  assert.equal(result.packets.length,1);
  assert.equal(result.packets[0].metadata.scene.meshes[1].id,'visible');
});

test('runtime retained-handle alias does not replay owner effects',async()=>{
  const result=await executeOnce(aliasSource);
  assert.equal(result.stdout,'');
  assert.equal(result.packets.length,1);
  assert.equal(result.packets[0].metadata.scene.meshes[1].id,'once');
});

test('runtime UI effect owns operands across later in-place mutation',async()=>{
  const result=await executeOnce(mutationSource);
  assert.equal(result.packets.length,2);
  assert.ok(result.packets[0].layout.bounds[3]<2,
    'first packet must retain its pre-mutation y values');
  assert.equal(result.packets[1].layout.bounds[3],999);
});

async function executeOnce(input){
  const bytes=await readFile(new URL('../../build/shared-ui-probe/vkf-compiler.wasm',import.meta.url));
  const compiler=(await WebAssembly.instantiate(bytes)).instance.exports;
  compiler._initialize?.();
  const encoded=new TextEncoder().encode(input);
  const sourcePointer=compiler.malloc(encoded.length);
  try{
    new Uint8Array(compiler.memory.buffer,sourcePointer,encoded.length).set(encoded);
    assert.equal(compiler.vkf_compile_source(sourcePointer,encoded.length),0,response(compiler).message);
    assert.equal(compiler.vkf_emit_program(),0,response(compiler).message);
    const emitted=response(compiler);
    const programBytes=new Uint8Array(compiler.memory.buffer,
      compiler.vkf_program_pointer(),compiler.vkf_program_length()).slice();
    const program=(await WebAssembly.instantiate(programBytes)).instance.exports;
    assert.equal(program.vkf_vm_invoke(emitted.manifest.functions.$vkf_main.index,0),0);
    const used=Math.max(program.vkf_vm_heap_ptr(),
      program.vkf_vm_results_ptr()+program.vkf_vm_value_slot_size());
    const memory=new Uint8Array(program.memory.buffer,0,used);
    const pointer=compiler.malloc(memory.length);
    try{
      new Uint8Array(compiler.memory.buffer,pointer,memory.length).set(memory);
      assert.equal(compiler.vkf_format_stdout(pointer,memory.length,
        program.vkf_vm_results_ptr()),0);
      const stdout=response(compiler).stdout;
      assert.equal(compiler.vkf_format_ui_packets(pointer,memory.length,
        program.vkf_vm_results_ptr(),640,360),0);
      return {stdout,packets:response(compiler).packets};
    }finally{compiler.free(pointer);}
  }finally{compiler.free(sourcePointer);}
}

function response(api){
  return JSON.parse(new TextDecoder().decode(new Uint8Array(api.memory.buffer,
    api.vkf_result_pointer(),api.vkf_result_length())));
}
