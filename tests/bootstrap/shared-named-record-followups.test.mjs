// Deliberate independent REDs discovered while testing named-capture ownership.
// Neither tuple/vector conflation nor append-instead-of-update is an acceptance path.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {createSharedCompiler} from '../../web/playground/vkf-shared-compiler.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
const compiler=createSharedCompiler({instance:new WebAssembly.Instance(new WebAssembly.Module(
  await readFile(join(root,'build/shared-compiler/vkf-compiler.wasm'))))});
async function nativeStdout(source){
  const directory=await mkdtemp(join(root,'build/shared-named-followup-'));
  const file=join(directory,'program.vkf');await writeFile(file,source);
  const result=spawnSync(join(root,'build/native-compiler-docker/bin/vkf-strict'),[file,'-o',join(directory,'program')],
    {encoding:'utf8',timeout:30_000,windowsHide:true});
  assert.equal(result.error,undefined,result.error?.message);
  assert.equal(result.status,0,result.stderr);
  assert.equal(result.stderr,'');
  return result.stdout;
}

test('native named-capture display preserves tuple identity like the emitted WASM value',async()=>{
  const source='capture(value:int, :::named):named\npair:(1,2)\n::capture(0,pair:pair)\n';
  const native=await nativeStdout(source);
  assert.equal(compiler.run(source).stdout,'(pair:(1, 2))\n');
  assert.equal(native,'(pair:(1, 2))\n');
});

test('record field update replaces the existing field in place rather than appending a duplicate',async()=>{
  const source='record:(points:[3,4],label:"original")\nrecord.points:[8,4]\n::record\n';
  const native=await nativeStdout(source);
  assert.equal(native,'(points:[8, 4], label:original)\n');
  assert.deepEqual(compiler.run(source),{kind:'console',stdout:native,stderr:''});
});
