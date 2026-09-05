// Numerical audit only: never imported by the browser compiler/runner.
// Run wasm-math-kernels.test.mjs first to generate the current isolated harness.
import {readFileSync, readdirSync, statSync, writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const directories=readdirSync('build').filter(x=>x.startsWith('wasm-math-test-'))
  .sort((a,b)=>statSync(`build/${b}`).mtimeMs-statSync(`build/${a}`).mtimeMs);
const directory=`build/${directories[0]}`;
const wasm=readFileSync(`${directory}/math.wasm`);
const api=(await WebAssembly.instantiate(wasm)).instance.exports;
const bytes=new ArrayBuffer(8), view=new DataView(bytes);
const hex=x=>{view.setFloat64(0,x,false); return view.getBigUint64(0,false).toString(16).padStart(16,'0');};
const fromBits=x=>{view.setBigUint64(0,x,false);return view.getFloat64(0,false);};
const points=[];
const add=(group,x)=>points.push({group,x});
for(let i=0;i<=100;i++) add('readme101',0.1*i);
for(let i=-100;i<=100;i++) add('decimal-grid',i/10);
for(let i=-32;i<=32;i++) {
  const x=i*Math.PI/2;
  view.setFloat64(0,x,false);const bits=view.getBigUint64(0,false);
  add('quadrant-neighbors',x);
  if(x!==0) {add('quadrant-neighbors',fromBits(bits-1n));add('quadrant-neighbors',fromBits(bits+1n));}
}
for(const x of [0,-0,Number.MIN_VALUE,-Number.MIN_VALUE,2**-1022,-(2**-1022),
  1e3,1e6,1e12,1e20,1e100,Number.MAX_VALUE,-Number.MAX_VALUE,Infinity,-Infinity,NaN]) add('edges',x);
let state=0x3e271a55;
const next=()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return state>>>0;};
for(let exponent=0;exponent<2047;exponent++) for(const kind of ['zero','ones','random']) {
  const low=kind==='zero'?0:kind==='ones'?0xffffffff:next();
  const high=kind==='zero'?0:kind==='ones'?0xfffff:next()&0xfffff;
  for(const negative of [false,true]) {
    const bits=(BigInt(negative?1:0)<<63n)|(BigInt(exponent)<<52n)|(BigInt(high)<<32n)|BigInt(low);
    add('exponent-bands',fromBits(bits));
  }
}
const input=Buffer.alloc(points.length*8);
points.forEach(({x},i)=>input.writeDoubleLE(x,i*8));
const native=spawnSync(`${directory}/generator`,['--oracle'],{input,timeout:30000,maxBuffer:input.length*4});
assert.equal(native.status,0,native.stderr?.toString());
assert.equal(native.stdout.length,points.length*24);
const rows=points.map(({group,x},i)=>{
  const memory=new DataView(api.memory.buffer);
  const invoke=name=>{memory.setFloat64(8,x,true);return memory.getFloat64(api[name](0)+8,true);};
  return {group,input:hex(x),nativeSin:hex(native.stdout.readDoubleLE(i*24)),
    nativeCos:hex(native.stdout.readDoubleLE(i*24+8)),wasmSin:hex(invoke('sine')),wasmCos:hex(invoke('cosine'))};
});
const output={harness:directory,wasmSha256:createHash('sha256').update(wasm).digest('hex'),
  kernelSha256:createHash('sha256').update(readFileSync('compiler/native/vkf_wasm_math_kernels.hpp')).digest('hex'),
  nativePlatform:spawnSync('ldd',['--version'],{encoding:'utf8'}).stdout.split('\n')[0],rows};
writeFileSync('build/shared-trigonometry-observations.json',JSON.stringify(output));
console.log(JSON.stringify({inputs:rows.length,harness:directory,wasmSha256:output.wasmSha256}));
