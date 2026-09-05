// Candidate-only build: never changes the shared/native production artifacts.
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const directory='build/trig-candidate';mkdirSync(directory,{recursive:true});
const names=['sin.c','cos.c','__sin.c','__cos.c','__rem_pio2.c','__rem_pio2_large.c','scalbn.c','floor.c'];
const sources=names.map(x=>'compiler/native/runtime/trig/'+x);
const flags=['-std=c11','-O2','-ffp-contract=off','-fno-fast-math','-fno-builtin','-fexcess-precision=standard'];
function run(command,args){const r=spawnSync(command,args,{encoding:'utf8',timeout:120000});assert.equal(r.status,0,r.stderr??r.error?.message);}
run('emcc',[...flags,...sources,'--no-entry','-sSTANDALONE_WASM=1','-sFILESYSTEM=0','-sEXPORTED_FUNCTIONS=["_vkf_trig_v1_sin","_vkf_trig_v1_cos"]','-o',directory+'/trig.wasm']);
writeFileSync(directory+'/oracle.c',`#include <stdio.h>\ndouble vkf_trig_v1_sin(double);\ndouble vkf_trig_v1_cos(double);\nint main(void){double x;while(fread(&x,sizeof(x),1,stdin)==1){double y[2]={vkf_trig_v1_sin(x),vkf_trig_v1_cos(x)};if(fwrite(y,sizeof(y),1,stdout)!=1)return 1;}return 0;}\n`);
run('gcc',[...flags,...sources,directory+'/oracle.c','-o',directory+'/oracle']);
const hashes=Object.fromEntries([...sources,'compiler/native/runtime/trig/vkf_trig_internal.h'].map(file=>[file,createHash('sha256').update(readFileSync(file)).digest('hex')]));
writeFileSync(directory+'/manifest.json',JSON.stringify({policy:'vkf-trig-v1-candidate',upstream:'emscripten/emsdk:4.0.14 bundled musl src/math',flags,hashes},null,2));
console.log(JSON.stringify({directory,flags}));
