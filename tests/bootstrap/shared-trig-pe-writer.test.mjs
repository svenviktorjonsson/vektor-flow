import assert from 'node:assert/strict';
import {mkdtemp, writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {join, relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';

// This gate requires an actual Windows host; it never substitutes a package
// calling-convention harness for final PE loader/process execution.
assert.equal(process.platform, 'win32', 'run the PE process gate on Windows');
const root = fileURLToPath(new URL('../../', import.meta.url));
const directory = await mkdtemp(join(root, 'build/trig-pe-writer-'));
const mounted = '/src/' + relative(root, directory).replaceAll('\\', '/');
function run(command, args, timeout=30_000) {
  const result = spawnSync(command, args, {encoding:'utf8', timeout, windowsHide:true});
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr);
  return result;
}
await writeFile(join(directory, 'writer.cpp'), `
#include "compiler/native/vkf_pe_writer.hpp"
#include <fstream>
#include <cstring>
int main(int argc,char**argv){
  const bool cosine=argv[2][0]=='c';
  // Windows entry receives the unchanged runtime table in rcx; tail-call its
  // sine/cosine slot with 2.5 in xmm0. The PE writer owns imports and placement.
  std::vector<std::uint8_t> code={0x48,0xb8,0,0,0,0,0,0,0,0,0x66,0x48,0x0f,0x6e,0xc0,0xff,0x61,static_cast<std::uint8_t>(cosine?40:32)};
  double x=2.5;std::memcpy(code.data()+2,&x,8);
  vkf::pe::MathImports imports;imports.sin=!cosine;imports.cos=cosine;
  const auto image=vkf::pe::executable_x64(code,{},false,false,0,imports);
  std::ofstream out(argv[1],std::ios::binary);out.write(reinterpret_cast<const char*>(image.bytes.data()),image.bytes.size());
  return out?0:1;
}
`);
const docker = ['run','--rm','-v',`${root.replaceAll('\\','/')}:/src`,'-w','/src','vkf-trig-toolchain:14'];
run('docker', [...docker,'g++','-std=c++17','-I/src','-I/src/compiler/native',mounted+'/writer.cpp','-o',mounted+'/writer'],120_000);
for (const [name,expected] of [['sin','0.59847214410395644\r\n'],['cos','-0.8011436155469337\r\n']]) {
  test(`the final PE ${name} program runs on Windows without importing platform trig`, () => {
    run('docker',[...docker,mounted+'/writer',mounted+'/'+name+'.exe',name]);
    const imports=run('docker',[...docker,'llvm-readobj-14','--coff-imports',mounted+'/'+name+'.exe']).stdout;
    assert.doesNotMatch(imports,/Symbol: (?:sin|cos)\b/);
    const result=run(join(directory,name+'.exe'),[]);
    assert.equal(result.stdout,expected);
    assert.equal(result.stderr,'');
  });
}
