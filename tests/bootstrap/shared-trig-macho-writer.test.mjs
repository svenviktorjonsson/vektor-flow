import assert from 'node:assert/strict';
import {mkdtemp, readFile, writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';

const root=fileURLToPath(new URL('../../',import.meta.url));
const directory=await mkdtemp(join(root,'build/trig-macho-writer-'));
const bin=join(root,'build/native-compiler-docker/bin');
function run(command,args){
  const r=spawnSync(command,args,{encoding:'utf8',timeout:30_000});
  assert.equal(r.error,undefined,r.error?.message);
  assert.equal(r.status,0,r.stderr);
  return r.stdout;
}
test('the emitted Mach-O covers its compiler-owned trig with executable section metadata and has no platform trig binds',async()=>{
  const source=join(directory,'trig.vkf');
  await writeFile(source,':: math.sin(2.5)\n:: math.cos(2.5)\n');
  run(join(bin,'vkf-strict'),['--diagnostics',source,'-o',join(directory,'trig')]);
  run(join(bin,'vkf_arm64_artifact'),['--source',source,'--typed-ir',join(directory,'.vkfbuild/trig/typed-ir.json')]);
  const file=join(directory,'.vkfbuild/trig/trig-arm64');
  const image=await readFile(file);
  assert.equal(image.readUInt32LE(),0xfeedfacf);
  const packageBytes=await readFile(join(root,'build/trig-native-package/arm64/package.bin'));
  const packageOffset=image.indexOf(packageBytes);
  assert.ok(packageOffset>=0,'the final image embeds the audited ARM64 package');
  assert.equal(packageOffset%4096,0,'ADRP constants retain package page alignment');
  let text;
  for(let i=0,p=32;i<image.readUInt32LE(16);i++){
    const command=image.readUInt32LE(p),size=image.readUInt32LE(p+4);
    if(command===0x19){
      for(let s=0,q=p+72;s<image.readUInt32LE(p+64);s++,q+=80){
        const name=image.toString('ascii',q,q+16).replaceAll('\0','');
        if(name==='__text')text={offset:image.readUInt32LE(q+48),size:Number(image.readBigUInt64LE(q+40))};
      }
    }
    p+=size;
  }
  assert.ok(text);
  assert.ok(packageOffset>=text.offset&&packageOffset+packageBytes.length<=text.offset+text.size,
    'the entire trig package must belong to the executable __text section');
  const binds=run('llvm-objdump-14',['--macho','--bind',file]);
  assert.doesNotMatch(binds,/\b_(?:sin|cos)\b/);
});
