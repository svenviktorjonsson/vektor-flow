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
async function nativeExecution(source){
  const directory=await mkdtemp(join(root,'build/shared-named-variadic-'));
  const file=join(directory,'program.vkf');await writeFile(file,source);
  const result=spawnSync(join(root,'build/native-compiler-docker/bin/vkf-strict'),[file,'-o',join(directory,'program')],
    {encoding:'utf8',timeout:30_000,windowsHide:true});
  assert.equal(result.error,undefined,result.error?.message);
  return result;
}
async function nativeResult(source){
  const result=await nativeExecution(source);
  assert.equal(result.status,0,result.stderr);
  assert.equal(result.stderr,'');
  return {kind:'console',stdout:result.stdout,stderr:result.stderr};
}
test('the unchanged guide variadic example returns the native captured record',async()=>{
  const source=await readFile(join(root,'examples/generated/readme/core/22-variadics-spreads.vkf'),'utf8');
  const native=await nativeResult(source);
  assert.equal(native.stdout,'10\n7\n(flag:true, mode:fast)\n');
  assert.deepEqual(compiler.run(source),native);
  assert.deepEqual(compiler.run(source),native,'a repeated run resets the captured record');
});

test('all 14 unchanged canonical call cases execute with exact native parity',async context=>{
  const source=await readFile(join(root,'tests/vkf/calls.vkf'),'utf8');
  const suite=compiler.describeTests(source,'tests/vkf/calls.vkf');
  assert.equal(suite.tests.length,14);
  for(const entry of suite.tests) await context.test(entry.name,async()=>{
    assert.deepEqual(compiler.run(entry.source),await nativeResult(entry.source));
  });
});

test('captured named values survive a default-argument thunk without being rebound positionally',async()=>{
  const source='capture(value:int=5, :::named):named\n:: capture(flag:true, mode:"fast")\n';
  const native=await nativeResult(source);
  assert.equal(native.stdout,'(flag:true, mode:fast)\n');
  assert.deepEqual(compiler.run(source),native);
});

test('missing and duplicate captured fields retain exact native first-error diagnostics',async()=>{
  for(const [source,message] of [
    ['capture(value:int, :::named):named\n::capture(0,z:1)\n::capture(0,a:2,b:3)\n',
      'missing captured named argument a for capture'],
    ['capture(value:int, :::named):named\n::capture(0,a:1,a:2,z:3,z:4)\n',
      'multiple values for variadic named argument a'],
  ]){
    const native=await nativeExecution(source);
    assert.notEqual(native.status,0);
    assert.equal(native.stdout,'');
    assert.equal(native.stderr,`<driver-smoke>:1:1: direct x64 backend unsupported: ${message}\n`);
    assert.throws(()=>compiler.run(source),error=>error.phase==='lowering'&&error.message===message);
  }
});

test('named capture preserves native field/effect order and omitted versus provided defaults',async()=>{
  const source=`mark(value:int)->int:
    :: value
    value
capture(value:int=mark(0), :::named):named
:: capture(z:mark(3), a:mark(1), text:"ok" & "!")
:: capture(9, z:mark(4), a:mark(2), text:"yes" & "!")
`;
  const native=await nativeResult(source);
  assert.equal(native.stdout,'3\n1\n0\n(z:3, a:1, text:ok!)\n4\n2\n(z:4, a:2, text:yes!)\n');
  assert.deepEqual(compiler.run(source),native);
  assert.deepEqual(compiler.run(source),native,'capture/default effects execute once per run');
});

test('captured aggregate and owned text retain native copy isolation after caller updates',async()=>{
  const source=`capture(value:int, :::named):named
values:[1,2]
text:"hello" & "!"
captured:capture(0, points:values, text:text)
values.0:9
.text:"later"
:: captured
:: values
:: text
`;
  const native=await nativeResult(source);
  assert.equal(native.stdout,'(points:[1, 2], text:hello!)\n[9, 2]\nlater\n');
  assert.deepEqual(compiler.run(source),native);
});

test('nested numeric vectors are copied once and a supplied fixed argument skips its failing default',async()=>{
  const source=`capture(value:int=(0)?!, :::named):named
matrix:[[1,2],[3,4]]
captured:capture(7, points:matrix)
matrix.0:[8,9]
:: captured
:: matrix
`;
  const native=await nativeResult(source);
  assert.equal(native.stdout,'(points:[[1, 2], [3, 4]])\n[[8, 9], [3, 4]]\n');
  assert.deepEqual(compiler.run(source),native);
});
