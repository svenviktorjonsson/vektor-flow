import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import {runInlineWorkerRequest} from '../../web/inline-runner-worker.mjs';

const repository=path.resolve(import.meta.dirname,'../..');
const source=`: .ui.display
:.math
display:Display()
frame:display.add_frame(pos:[0.08,0.08],size:[0.84,0.84])
x:0.1[..100]
y:sin(x)
frame.add(x_u:x,y_u:y,id:"sine",color:[0.12,0.72,1,1])
`;

function response(api){
  return JSON.parse(new TextDecoder().decode(new Uint8Array(api.memory.buffer,
    api.vkf_result_pointer(),api.vkf_result_length())));
}

async function executedRetainedOracle(bytes){
  const compiler=(await WebAssembly.instantiate(bytes)).instance.exports;
  compiler._initialize?.();
  assert.equal(typeof compiler.vkf_format_retained_ui_packets,'function',
    'private executed-value retained formatter is missing');
  const encoded=new TextEncoder().encode(source);
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
    const pointer=compiler.malloc(used);
    try{
      new Uint8Array(compiler.memory.buffer,pointer,used)
        .set(new Uint8Array(program.memory.buffer,0,used));
      assert.equal(compiler.vkf_format_retained_ui_packets(pointer,used,
        program.vkf_vm_results_ptr()),0,response(compiler).message);
      return response(compiler).retained_scene_arenas;
    }finally{compiler.free(pointer);}
  }finally{compiler.free(sourcePointer);}
}

test('actual inline worker returns the native retained scene arena for README sine',async()=>{
  const [bytes,privateBytes]=await Promise.all([
    readFile(path.join(repository,'build/shared-compiler/vkf-compiler.wasm')),
    readFile(path.join(repository,'build/shared-ui-probe/vkf-compiler.wasm')),
  ]);
  const expected=await executedRetainedOracle(privateBytes);
  const module=new WebAssembly.Module(bytes);
  assert.deepEqual(WebAssembly.Module.imports(module),[]);

  const response=runInlineWorkerRequest({type:'run',id:1,source,module});
  assert.equal(response.status,'ok',response.message);
  assert.equal(response.output.kind,'visual');
  assert.equal(response.output.retained_scene_arenas.length,1);
  const actual=response.output.retained_scene_arenas[0];
  assert.deepEqual(actual.metadata,expected[0].metadata);
  assert.deepEqual([...actual.arena],expected[0].arena);
  assert.equal(actual.metadata.scene.meshes[0].topology,'line-list');
  assert.equal(actual.metadata.scene.meshes[0].marker_space,'pixel');
  assert.deepEqual(actual.metadata.scene.meshes[0].axis_ticks,{
    enabled:true,x_label:'x',y_label:'y',
  });
  assert.equal(actual.metadata.scene.meshes.some(({id})=>id==='sine$axes'),false);
  assert.equal(actual.metadata.scene.background,undefined);
});
