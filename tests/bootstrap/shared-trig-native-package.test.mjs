import assert from 'node:assert/strict';
import {mkdtemp, readFile, writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../../', import.meta.url));
const directory = await mkdtemp(join(root, 'build/trig-native-test-'));
const manifest = JSON.parse(await readFile(join(root, 'build/trig-native-package/manifest.json'), 'utf8'));
const observations = JSON.parse(await readFile(join(root, 'build/trig-candidate/observations.json'), 'utf8'));
assert.equal(observations.rows.length, 12793);
const input = Buffer.alloc(observations.rows.length * 8);
observations.rows.forEach((row, index) => input.writeDoubleLE(Buffer.from(row.input, 'hex').readDoubleBE(), index * 8));
function run(command, args) {
  const result = spawnSync(command, args, {encoding:'utf8', timeout:120_000});
  assert.equal(result.status, 0, result.stderr ?? result.error?.message);
}
function check(command, args, description) {
  const result = spawnSync(command, args, {input, timeout:30_000, maxBuffer:input.length * 2 + 1024});
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr?.toString());
  assert.equal(result.stdout.length, input.length * 2);
  observations.rows.forEach((row, index) => {
    assert.equal(result.stdout.readDoubleLE(index * 16), Buffer.from(row.wasmSin, 'hex').readDoubleBE(), `${description} sin ${row.input}`);
    assert.equal(result.stdout.readDoubleLE(index * 16 + 8), Buffer.from(row.wasmCos, 'hex').readDoubleBE(), `${description} cos ${row.input}`);
  });
}

for (const name of ['x64_sysv', 'x64_windows']) {
  test(`${name} relocated native bundle preserves the frozen candidate results`, async () => {
    const target = manifest.packages.find(item => item.name === name);
    assert.ok(target);
    const file = join(directory, name + '.cpp'), executable = join(directory, name);
    await writeFile(file, String.raw`
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <iterator>
#include <vector>
#include <sys/mman.h>
#include "compiler/native/runtime/vkf_trig_native.generated.hpp"
int main(int argc, char** argv) {
    const auto& package=vkf::trig::native_package::${name};
    const std::vector<unsigned char> bytes(package.bytes,package.bytes+package.size);
    if(bytes.empty())return 1;
    const auto shift=std::strtoul(argv[2],nullptr,10);
    auto* memory=static_cast<unsigned char*>(mmap(nullptr,bytes.size()+shift,PROT_READ|PROT_WRITE,MAP_PRIVATE|MAP_ANONYMOUS,-1,0));
    if(memory==MAP_FAILED)return 2;
    std::memcpy(memory+shift,bytes.data(),bytes.size());
    if(mprotect(memory,bytes.size()+shift,PROT_READ|PROT_EXEC))return 3;
    using Unary=double (${name === 'x64_windows' ? '__attribute__((ms_abi)) ' : ''}*)(double);
    const auto sine=reinterpret_cast<Unary>(memory+shift+package.sine_offset);
    const auto cosine=reinterpret_cast<Unary>(memory+shift+package.cosine_offset);
    double x;
    while(std::fread(&x,sizeof(x),1,stdin)==1) {
        const double result[]={sine(x),cosine(x)};
        if(std::fwrite(result,sizeof(result),1,stdout)!=1)return 4;
    }
    return 0;
}
`);
    run('g++', ['-std=c++17', '-O0', '-I'+root, file, '-o', executable]);
    const binary = join(root, 'build/trig-native-package', name, 'package.bin');
    for (const shift of [0, 4096]) check(executable, [binary, String(shift)], `${name} shift=${shift}`);
  });
}

test('ARM64 relocated native bundle preserves the frozen candidate results under QEMU', async () => {
  const target = manifest.packages.find(item => item.name === 'arm64');
  assert.ok(target);
  const file = join(directory, 'arm64.c'), assembly = join(directory, 'arm64.S');
  const executable = join(directory, 'arm64');
  await writeFile(assembly, `.section .text.trig,"ax",%progbits\n.balign 4096\n.global trig_blob\ntrig_blob:\n.incbin "${join(root, 'build/trig-native-package/arm64/package.bin')}"\n`);
  await writeFile(file, `
extern const unsigned char trig_blob[];
static long io(long operation,long fd,void* data,long size) {
    register long x0 __asm__("x0")=fd;
    register long x1 __asm__("x1")=(long)data;
    register long x2 __asm__("x2")=size;
    register long x8 __asm__("x8")=operation;
    __asm__ volatile("svc #0" : "+r"(x0) : "r"(x1),"r"(x2),"r"(x8) : "memory","cc");
    return x0;
}
int main(void) {
    double x;
    double (*sine)(double)=(double(*)(double))(trig_blob+${target.entryOffsets.sin});
    double (*cosine)(double)=(double(*)(double))(trig_blob+${target.entryOffsets.cos});
    for(;;) {
        long count=0;
        while(count<8) {
            long n=io(63,0,(char*)&x+count,8-count);
            if(n==0)return count?1:0;
            if(n<0)return 2;
            count+=n;
        }
        double result[2]={sine(x),cosine(x)};
        count=0;
        while(count<16) {
            long n=io(64,1,(char*)result+count,16-count);
            if(n<=0)return 3;
            count+=n;
        }
    }
}
__attribute__((naked)) void _start(void) {
    __asm__("bl main\\nmov x8,#93\\nsvc #0");
}
`);
  run('clang-14', ['--target=aarch64-linux-gnu', '-fuse-ld=lld-14', '-O0', '-ffreestanding',
    '-fno-builtin', '-fno-stack-protector', '-nostdlib', '-static', '-Wl,-e,_start', file, assembly, '-o', executable]);
  check('qemu-aarch64', [executable], 'ARM64 QEMU');
});
