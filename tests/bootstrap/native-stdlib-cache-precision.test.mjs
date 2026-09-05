import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {mkdtemp,mkdir,readFile,writeFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';

const root=fileURLToPath(new URL('../../',import.meta.url));
const native=path.join(root,'build/native-compiler-docker/bin/vkf-strict');
const sha=text=>createHash('sha256').update(text).digest('hex');
const exact=0.41421356237309503;
function constants(node,result=[]) {
  if(node&&typeof node==='object') {
    if(node.kind==='const'&&typeof node.value==='number') result.push(node.value);
    for(const child of Object.values(node)) constants(child,result);
  }
  return result;
}

test('stale v1 stdlib AST cannot replace exact source numbers; cold and warm diagnostics agree',async()=>{
  const directory=await mkdtemp(path.join(root,'build/native-cache-precision-test-'));
  const stdlib=path.join(directory,'compiler/self_hosted/stdlib');
  const cache=path.join(directory,'.vkfbuild/stdlib-cache');
  await mkdir(stdlib,{recursive:true});await mkdir(cache,{recursive:true});
  const moduleSource=`value: ${exact}\n`;
  const moduleFile=path.join(stdlib,'cache_probe.vkf');
  await writeFile(moduleFile,moduleSource);
  let invocation=0;
  function run(file) {
    const output=path.join(directory,`program-${invocation++}`);
    const result=spawnSync(native,['--diagnostics',file,'-o',output],{cwd:directory,encoding:'utf8',timeout:30000});
    assert.equal(result.error,undefined,result.error?.message);
    assert.equal(result.status,0,result.stderr);
    assert.equal(result.stderr,'');return result;
  }
  run(moduleFile);
  const ast=JSON.parse(await readFile(path.join(stdlib,'.vkfbuild/cache_probe/ast.json'),'utf8'));
  let replaced=0;
  function round(node) {
    if(node&&typeof node==='object') {
      for(const [key,value] of Object.entries(node)) {
        if(value===exact){node[key]=0.414213562373095;replaced++;}
        else round(value);
      }
    }
  }
  round(ast);assert.ok(replaced>0,'fixture must contain the parsed numeric literal');
  const schema='vkf-stdlib-ast-v1';
  const staleFile=path.join(cache,`cache_probe-${sha(schema+'\0'+moduleSource)}.ast.json`);
  const stale=JSON.stringify({schema,source_sha256:sha(moduleSource),ast})+'\n';
  await writeFile(staleFile,stale);
  const entry=path.join(directory,'main.vkf');
  await writeFile(entry,'m: .cache_probe\n:: m.value\n');
  const observations=[];
  for(let pass=0;pass<2;pass++) {
    const result=run(entry);
    const typed=JSON.parse(await readFile(path.join(directory,'.vkfbuild/main/typed-ir.json'),'utf8'));
    assert.ok(constants(typed).includes(exact),'native diagnostics reused a rounded v1 AST instead of authoritative source');
    assert.ok(!constants(typed).includes(0.414213562373095));
    assert.ok(result.stdout.startsWith('0.41421356237309503\n'),result.stdout);
    observations.push(typed);
  }
  assert.deepEqual(observations[1],observations[0],'cold and warm canonical IR must agree exactly');
  assert.equal(await readFile(staleFile,'utf8'),stale,'obsolete cache remains recoverable and untouched');
  const currentFiles=(await readdir(cache)).filter(name=>name.endsWith('.ast.json')&&name!==path.basename(staleFile));
  assert.equal(currentFiles.length,1,'fresh exact AST must be cached under a different private identity');
  const current=JSON.parse(await readFile(path.join(cache,currentFiles[0]),'utf8'));
  assert.notEqual(current.schema,schema);
});
