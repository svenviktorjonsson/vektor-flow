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

test('runtime UI effects pack executed operand snapshots in source order',async()=>{
  const bytes=await readFile(new URL('../../build/shared-ui-probe/vkf-compiler.wasm',import.meta.url));
  const compiler=(await WebAssembly.instantiate(bytes)).instance.exports;
  compiler._initialize?.();
  assert.equal(typeof compiler.vkf_format_ui_packets,'function','private runtime packet extractor is missing');
  const encoded=new TextEncoder().encode(source);
  const sourcePointer=compiler.malloc(encoded.length);
  try{
    new Uint8Array(compiler.memory.buffer,sourcePointer,encoded.length).set(encoded);
    assert.equal(compiler.vkf_compile_source(sourcePointer,encoded.length),0);
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

function response(api){
  return JSON.parse(new TextDecoder().decode(new Uint8Array(api.memory.buffer,
    api.vkf_result_pointer(),api.vkf_result_length())));
}
