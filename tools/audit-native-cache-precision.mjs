// Diagnostic audit: preserve the existing cache and compare an uncached copy.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
const root=process.cwd();
const cache=path.join(root,'.vkfbuild/stdlib-cache/math-dd7f69a56d6971511ba9345d7f55c65bdb138b89fdbf50c4423cd1b61f24b046.ast.json');
const hash=()=>createHash('sha256').update(readFileSync(cache)).digest('hex');
const before=hash(),directory=mkdtempSync(path.join(root,'build/cache-precision-audit-'));
const compiler=path.join(root,'build/native-compiler-docker/bin/vkf-strict');
const source='m: .math\n:: m.log(8, 2)\n';
const output={directory,cache,cacheSha256Before:before,observations:[]};
for(const mode of ['existing-cache','uncached-copy']) {
  const cwd=path.join(directory,mode);mkdirSync(cwd);
  const file=path.join(cwd,'main.vkf');writeFileSync(file,source);
  if(mode==='uncached-copy') writeFileSync(path.join(cwd,'math.vkf'),readFileSync('compiler/self_hosted/stdlib/math.vkf'));
  const run=spawnSync(compiler,['--diagnostics',file],{cwd:root,encoding:'utf8',timeout:30000,maxBuffer:16*1024*1024});
  assert.equal(run.status,0,run.stderr);
  const ir=JSON.parse(readFileSync(path.join(cwd,'.vkfbuild/main/typed-ir.json'),'utf8'));
  const numbers=[];
  function visit(x){if(!x||typeof x!=='object')return;if(x.kind==='const'&&typeof x.value==='number')numbers.push(x.value);for(const v of Object.values(x))visit(v);}
  visit(ir);
  output.observations.push({mode,hasExact:numbers.includes(0.41421356237309503),hasRounded:numbers.includes(0.414213562373095),stdout:run.stdout.split('\n')[0],stderr:run.stderr});
}
output.cacheSha256After=hash();assert.equal(output.cacheSha256After,before);
writeFileSync('build/native-cache-precision-audit.json',JSON.stringify(output,null,2));
console.log(JSON.stringify(output,null,2));
