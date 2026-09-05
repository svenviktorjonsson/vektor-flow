import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
const baseline=process.env.VKF_TRIG_BASELINE_ARTIFACT;
const artifact=baseline??new URL('../../build/trig-candidate/trig.wasm',import.meta.url);
const module=new WebAssembly.Module(await readFile(artifact));
assert.deepEqual(WebAssembly.Module.imports(module),[]);
const api=new WebAssembly.Instance(module).exports;
function invoke(name,x) {
  if(!baseline)return api[name](x);
  const memory=new DataView(api.memory.buffer);memory.setFloat64(8,x,true);
  return memory.getFloat64(api[name==='vkf_trig_v1_sin'?'sine':'cosine'](0)+8,true);
}
function ordered(x) {
  const bytes=new ArrayBuffer(8),view=new DataView(bytes);view.setFloat64(0,x,false);
  const bits=view.getBigUint64(0,false),sign=1n<<63n;
  return bits&sign?(~bits&((1n<<64n)-1n)):(bits|sign);
}
test('portable candidate retains high-precision near-root sine and cosine values',()=>{
  // Exact binary64 references independently agreed at 400 and 600 digits.
  for(const [name,x,reference] of [
    ['vkf_trig_v1_cos',-Math.PI/2,6.123233995736766e-17],
    ['vkf_trig_v1_sin',-2*Math.PI,2.4492935982947064e-16],
    ['vkf_trig_v1_sin',9.4,0.024775425453357765],
    ['vkf_trig_v1_sin',Number.MAX_VALUE,0.004961954789184062],
  ]) {
    const actual=invoke(name,x),delta=ordered(actual)-ordered(reference);
    assert.ok(delta>=-1n&&delta<=1n,`${name}(${x}): actual ${actual}, reference ${reference}, binary64 steps ${delta}`);
  }
});
