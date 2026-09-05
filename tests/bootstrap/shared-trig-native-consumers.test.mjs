import assert from 'node:assert/strict';
import {mkdtemp, readFile, writeFile, chmod} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../../', import.meta.url));
const build = await mkdtemp(join(root, 'build/trig-consumers-'));
const bin = join(root, 'build/native-compiler-docker/bin');
function run(command, args, options = {}) {
  const result = spawnSync(command, args, {encoding:'utf8', timeout:30_000, ...options});
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr?.toString());
  return result;
}

test('the production C runtime archive preserves every frozen candidate bit', async () => {
  const observations = JSON.parse(await readFile(join(root, 'build/trig-candidate/observations.json'), 'utf8'));
  assert.equal(observations.rows.length, 12793);
  const file = join(build, 'archive.cpp'), executable = join(build, 'archive');
  await writeFile(file, `#include <cstdio>\n#include "compiler/native/runtime/vkf_trig.h"\nint main(){double x;while(std::fread(&x,8,1,stdin)==1){double y[]={vkf_trig_v1_sin(x),vkf_trig_v1_cos(x)};if(std::fwrite(y,16,1,stdout)!=1)return 1;}}\n`);
  run('g++', ['-std=c++17', '-I'+root, file, join(root, 'build/native-compiler-docker/libvkf_trig.a'), '-o', executable]);
  const input = Buffer.alloc(observations.rows.length * 8);
  observations.rows.forEach((row, i) => input.writeDoubleLE(Buffer.from(row.input, 'hex').readDoubleBE(), i*8));
  const result = run(executable, [], {input, encoding:null, maxBuffer:input.length*2+1024});
  assert.equal(result.stdout.length, input.length*2);
  observations.rows.forEach((row, i) => {
    assert.equal(result.stdout.readDoubleLE(i*16), Buffer.from(row.wasmSin, 'hex').readDoubleBE(), `sin ${row.input}`);
    assert.equal(result.stdout.readDoubleLE(i*16+8), Buffer.from(row.wasmCos, 'hex').readDoubleBE(), `cos ${row.input}`);
  });
});

test('the final runner executable dispatches both retained runtime slots to the accepted policy', async () => {
  const template = await readFile(join(bin, 'vkf_x64_runner_template'));
  const marker = Buffer.from('VKFX64AOTCODE001');
  const offset = template.indexOf(marker);
  assert.ok(offset >= 0);
  assert.equal(template.indexOf(marker, offset+1), -1);
  for (const [name, slot, expected] of [['sin', 32, '0.59847214410395644\n'], ['cos', 40, '-0.8011436155469337\n']]) {
    // SysV entry receives the unchanged runtime table in rdi. Tail-call its
    // slot with 2.5 in xmm0, preserving the runner's return address/alignment.
    const code = Buffer.from([0x48,0xb8,0,0,0,0,0,0,0,0,0x66,0x48,0x0f,0x6e,0xc0,0xff,0x67,slot]);
    code.writeDoubleLE(2.5, 2);
    const image = Buffer.from(template); code.copy(image, offset);
    const file = join(build, 'runner-'+name);
    await writeFile(file, image); await chmod(file, 0o755);
    const result = run(file, []);
    assert.equal(result.stdout, expected);
    assert.equal(result.stderr, '');
  }
});

test('the production constant evaluator uses the accepted sine and cosine policy', async () => {
  const source = join(build, 'constant.vkf');
  await writeFile(source, ':: math.sin(2.5)\n:: math.cos(2.5)\n');
  run(join(bin, 'vkf-strict'), ['--diagnostics', source, '-o', join(build, 'constant')]);
  const native = run(join(build, 'constant'), []);
  const symbols = run('llvm-readobj-14', ['--dyn-symbols', join(build, 'constant')]).stdout;
  assert.doesNotMatch(symbols, /Name: (?:sin|cos)(?:\s|@|$)/m);
  const evaluated = run(join(bin, 'vkf_compiler_artifact_smoke'), ['--run-typed-ir', '--source', source,
    '--typed-ir', join(build, '.vkfbuild/constant/typed-ir.json')]);
  assert.equal(evaluated.stdout, native.stdout);
  assert.equal(evaluated.stderr, '');
});

test('the retained numeric evaluator evaluates canonical frontend trig with the same exact results', async () => {
  const source = join(build, 'retained.vkf');
  await writeFile(source, ':: math.sin(2.5)\n:: math.cos(2.5)\n');
  run(join(bin, 'vkf-strict'), ['--diagnostics', source, '-o', join(build, 'retained')]);
  const file=join(build,'retained.cpp'), executable=join(build,'retained-evaluator');
  await writeFile(file, `
#include "compiler/native/vkf_retained_scene_packet.hpp"
#include <fstream>
#include <iostream>
#include <iomanip>
#include <iterator>
int main(int argc,char**argv){
  std::ifstream input(argv[1]);const std::string text((std::istreambuf_iterator<char>(input)),{});
  const auto ir=vf::parse_json(text);
  for(const auto& statement:ir.as_object().at("body").as_array()){
    const auto& expression=statement.as_object().at("expr").as_object().at("args").as_array().at(0);
    std::cout<<std::setprecision(17)<<vkf::retained_scene::detail::evaluate(expression,nullptr).as_number()<<"\\n";
  }
}
`);
  run('g++',['-std=c++17','-I'+root,'-I'+join(root,'compiler/native'),'-I'+join(root,'native/VfOverlay'),file,
    join(root,'native/VfOverlay/vf/json.cpp'),join(root,'build/native-compiler-docker/libvkf_trig.a'),'-o',executable],{timeout:120_000});
  const evaluated=run(executable,[join(build,'.vkfbuild/retained/typed-ir.json')]);
  assert.equal(evaluated.stdout,run(join(build,'retained'),[]).stdout);
  assert.equal(evaluated.stderr,'');
});

test('the actual optimizer executable-memory runtime table selects exact compiler-owned trig', async () => {
  const file=join(build,'jit.cpp'),executable=join(build,'jit');
  await writeFile(file, `
#define VKF_X64_BACKEND_LIBRARY
#include "compiler/native/vkf_x64_artifact.cpp"
#include <cstdio>
int main(){
  double x;
  while(std::fread(&x,8,1,stdin)==1){
    double values[2];
    for(int i=0;i<2;i++){
      std::vector<unsigned char> code={0x48,0xb8,0,0,0,0,0,0,0,0,0x66,0x48,0x0f,0x6e,0xc0,0xff,0x67,static_cast<unsigned char>(32+i*8)};
      std::memcpy(code.data()+2,&x,8);
      ExecutableCode program(code,nullptr);values[i]=program.run();
    }
    if(std::fwrite(values,16,1,stdout)!=1)return 1;
  }
}
`);
  run('g++',['-std=c++17','-O0','-ffunction-sections','-fdata-sections','-I'+root,
    '-I'+join(root,'compiler/native'),'-I'+join(root,'native/VfOverlay'),file,
    join(root,'build/native-compiler-docker/libvkf_trig.a'),'-Wl,--gc-sections','-o',executable],{timeout:120_000});
  const observations=JSON.parse(await readFile(join(root,'build/trig-candidate/observations.json'),'utf8'));
  assert.equal(observations.rows.length,12793);
  const input=Buffer.alloc(observations.rows.length*8);
  observations.rows.forEach((row,i)=>input.writeDoubleLE(Buffer.from(row.input,'hex').readDoubleBE(),i*8));
  const result=run(executable,[],{input,encoding:null,maxBuffer:input.length*2+1024});
  assert.equal(result.stdout.length,input.length*2);
  observations.rows.forEach((row,i)=>{
    assert.equal(result.stdout.readDoubleLE(i*16),Buffer.from(row.wasmSin,'hex').readDoubleBE(),`JIT sin ${row.input}`);
    assert.equal(result.stdout.readDoubleLE(i*16+8),Buffer.from(row.wasmCos,'hex').readDoubleBE(),`JIT cos ${row.input}`);
  });
});
