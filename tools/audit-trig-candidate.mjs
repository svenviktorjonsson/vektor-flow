// Same frozen numerical samples as the pre-decision audit, separate outputs.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const data=JSON.parse(readFileSync('build/shared-trigonometry-observations.json','utf8'));
const wasm=readFileSync('build/trig-candidate/trig.wasm');
const module=new WebAssembly.Module(wasm);
assert.deepEqual(WebAssembly.Module.imports(module),[]);
const api=new WebAssembly.Instance(module).exports;
const input=Buffer.alloc(data.rows.length*8);
data.rows.forEach((r,i)=>input.writeDoubleLE(Buffer.from(r.input,'hex').readDoubleBE(),i*8));
const native=spawnSync('build/trig-candidate/oracle',[],{input,timeout:30000,maxBuffer:input.length*3});
assert.equal(native.status,0,native.stderr?.toString());
assert.equal(native.stdout.length,input.length*2);
const hex=x=>{const bytes=Buffer.alloc(8);bytes.writeDoubleBE(x);return bytes.toString('hex');};
const rows=data.rows.map((r,i)=>{
  const x=input.readDoubleLE(i*8);
  const nativeSin=native.stdout.readDoubleLE(i*16),nativeCos=native.stdout.readDoubleLE(i*16+8);
  const wasmSin=api.vkf_trig_v1_sin(x),wasmCos=api.vkf_trig_v1_cos(x);
  for(const [name,a,b] of [['sin',nativeSin,wasmSin],['cos',nativeCos,wasmCos]]) {
    if(Number.isNaN(a))assert.ok(Number.isNaN(b));
    else assert.equal(hex(a),hex(b),`${name} native/WASM candidate differs at ${r.input}`);
  }
  return {group:r.group,input:r.input,nativeSin:hex(nativeSin),nativeCos:hex(nativeCos),wasmSin:hex(wasmSin),wasmCos:hex(wasmCos)};
});
const manifest=JSON.parse(readFileSync('build/trig-candidate/manifest.json','utf8'));
const result={policy:manifest.policy,wasmSha256:createHash('sha256').update(wasm).digest('hex'),
  sourceHashes:manifest.hashes,flags:manifest.flags,nativePlatform:'Linux x64 GCC; compiler-owned candidate (not system sin/cos)',
  bitParityInputs:rows.length,rows};
writeFileSync('build/trig-candidate/observations.json',JSON.stringify(result));
console.log(JSON.stringify({bitParityInputs:rows.length,wasmSha256:result.wasmSha256}));
