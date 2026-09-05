// Native code/data packages from the same canonical C source as the WASM package.
// Build in emscripten/emsdk:4.0.14 with clang-14, lld-14 and llvm-14 installed.
import assert from 'node:assert/strict';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import path from 'node:path';

const directory = path.resolve('build/trig-native-package');
mkdirSync(directory, {recursive:true});
const names = ['sin', 'cos', '__sin', '__cos', '__rem_pio2', '__rem_pio2_large', 'scalbn', 'floor'];
const sources = names.map(name => path.resolve('compiler/native/runtime/trig/' + name + '.c'));
const flags = ['-std=c11', '-O2', '-ffp-contract=off', '-fno-fast-math', '-fno-builtin',
  '-ffreestanding', '-fno-stack-protector', '-fno-unwind-tables', '-fno-asynchronous-unwind-tables',
  '-fvisibility=hidden', '-ffunction-sections', '-fdata-sections'];
function run(command, args) {
  const result = spawnSync(command, args, {encoding:'utf8', timeout:120_000});
  assert.equal(result.status, 0, result.stderr ?? result.error?.message);
  return result.stdout;
}
const version = run('clang-14', ['--version']);
assert.match(version, /clang version 14\./);
// Suppress only system-header dependencies for cross compilation. The canonical
// include guard, prefixed function declarations, arithmetic and tables remain.
const shimSource = readFileSync('compiler/native/runtime/trig/vkf_trig_internal.h', 'utf8').replace(/\r\n/g, '\n');
const shim = shimSource.replace('#include <stdint.h>\n#include <float.h>\n#include <math.h>', `
typedef __UINT64_TYPE__ uint64_t;
typedef __UINT32_TYPE__ uint32_t;
typedef __INT32_TYPE__ int32_t;
typedef double double_t;
#define FLT_EVAL_METHOD __FLT_EVAL_METHOD__
#define DBL_EPSILON __DBL_EPSILON__
#define LDBL_EPSILON __LDBL_EPSILON__
#define LDBL_MAX_EXP __LDBL_MAX_EXP__`);
assert.notEqual(shim, shimSource);
const shimPath = path.join(directory, 'freestanding.h');
writeFileSync(shimPath, shim);
const script = path.join(directory, 'package.ld');
writeFileSync(script, `SECTIONS { . = 0; .text : ALIGN(16) { *(.text*) *(.rodata*) }
 /DISCARD/ : { *(.eh_frame*) *(.comment*) *(.note*) *(.llvm_addrsig) } }\n`);
const hashes = Object.fromEntries([...sources, path.resolve('compiler/native/runtime/trig/vkf_trig_internal.h')]
  .map(file => [path.relative(process.cwd(), file), createHash('sha256').update(readFileSync(file, 'utf8').replace(/\r\n/g, '\n')).digest('hex')]));
const targets = [
  {name:'x64_sysv', triple:'x86_64-linux-gnu', flags:['-fPIC'], kind:'elf'},
  {name:'x64_windows', triple:'x86_64-pc-windows-msvc', flags:[], kind:'pe'},
  {name:'arm64', triple:'aarch64-linux-gnu', flags:['-fPIC', '-ffixed-x18'], kind:'elf'},
];
const packages = [];
const images = [];
for (const target of targets) {
  const build = path.join(directory, target.name); mkdirSync(build, {recursive:true});
  const objects = sources.map((source, index) => {
    const object = path.join(build, names[index] + '.o');
    run('clang-14', ['--target=' + target.triple, ...flags, ...target.flags, '-include', shimPath, '-c', source, '-o', object]);
    return object;
  });
  const linked = path.join(build, target.kind === 'pe' ? 'package.dll' : 'package.elf');
  const entryOffsets = {};
  let bytes;
  if (target.kind === 'elf') {
    run('ld.lld-14', ['--no-undefined', '-T', script, '-e', 'vkf_trig_v1_sin', '-o', linked, ...objects]);
    const elf = readFileSync(linked), sectionTable = Number(elf.readBigUInt64LE(40));
    const sectionSize = elf.readUInt16LE(58), sectionCount = elf.readUInt16LE(60);
    const nameSection = sectionTable + elf.readUInt16LE(62) * sectionSize;
    const namesOffset = Number(elf.readBigUInt64LE(nameSection + 24));
    for (let index = 0; index < sectionCount; ++index) {
      const section = sectionTable + index * sectionSize, attributes = elf.readBigUInt64LE(section + 8);
      if ((attributes & 2n) === 0n) continue;
      const nameStart = namesOffset + elf.readUInt32LE(section);
      const name = elf.subarray(nameStart, elf.indexOf(0, nameStart)).toString();
      assert.equal(name, '.text', 'unexpected allocated package section');
      assert.equal(attributes & 1n, 0n, 'package cannot need mutable static storage');
      assert.equal(elf.readBigUInt64LE(section + 16), 0n, 'package code must link at zero');
    }
    const symbolText = run('llvm-nm-14', ['-n', '--defined-only', linked]);
    for (const name of ['sin', 'cos']) {
      const match = symbolText.match(new RegExp(`^([0-9a-fA-F]+) [Tt] vkf_trig_v1_${name}$`, 'm'));
      assert.ok(match, symbolText); entryOffsets[name] = parseInt(match[1], 16);
    }
    assert.equal(run('llvm-nm-14', ['--undefined-only', linked]).trim(), '', 'external package symbol');
    const relocations = run('llvm-readobj-14', ['--relocations', linked]);
    assert.match(relocations, /Relocations \[\s*\]/, 'package must be fully relocated');
    const binary = path.join(build, 'package.bin');
    run('llvm-objcopy-14', ['--only-section=.text', '-O', 'binary', linked, binary]);
    bytes = readFileSync(binary);
  } else {
    // Clang's Windows floating-point linkage marker contains no runtime logic.
    // Supply it inside the read-only package instead of importing the CRT.
    const marker = path.join(build, 'fltused.c'), markerObject = path.join(build, 'fltused.o');
    writeFileSync(marker, 'const int _fltused = 0;\n');
    run('clang-14', ['--target=' + target.triple, ...flags, '-c', marker, '-o', markerObject]);
    run('lld-link-14', ['/dll', '/noentry', '/nodefaultlib', '/fixed', '/timestamp:0', '/machine:x64',
      '/merge:.rdata=.text', '/section:.text,ER', '/export:vkf_trig_v1_sin', '/export:vkf_trig_v1_cos',
      '/out:' + linked, ...objects, markerObject]);
    const pe = readFileSync(linked), header = pe.readUInt32LE(0x3c);
    const sectionCount = pe.readUInt16LE(header + 6), optionalSize = pe.readUInt16LE(header + 20);
    const optional = header + 24;
    assert.equal(pe.readUInt32LE(optional + 120), 0, 'unexpected PE import directory');
    assert.equal(pe.readUInt32LE(optional + 152), 0, 'unexpected PE base relocations');
    assert.equal(sectionCount, 1, 'only merged code/read-only data is allowed');
    const section = optional + optionalSize;
    assert.equal(pe.subarray(section, section + 8).toString().replace(/\0.*$/, ''), '.text');
    const virtualSize = pe.readUInt32LE(section + 8), rva = pe.readUInt32LE(section + 12);
    const fileOffset = pe.readUInt32LE(section + 20);
    bytes = pe.subarray(fileOffset, fileOffset + virtualSize);
    const exportText = run('llvm-readobj-14', ['--coff-exports', linked]);
    for (const name of ['sin', 'cos']) {
      const match = exportText.match(new RegExp(`Name: vkf_trig_v1_${name}\\s+RVA: (0x[0-9a-fA-F]+)`));
      assert.ok(match, exportText); entryOffsets[name] = parseInt(match[1], 16) - rva;
    }
    writeFileSync(path.join(build, 'package.bin'), bytes);
  }
  assert.ok(Object.values(entryOffsets).every(offset => offset >= 0 && offset < bytes.length));
  packages.push({...target, byteLength:bytes.length, entryOffsets,
    sha256:createHash('sha256').update(bytes).digest('hex')});
  images.push(bytes);
}
const sourceIdentity = createHash('sha256').update(JSON.stringify({hashes, flags, targets,
  compiler:version.trim(), shimSha256:createHash('sha256').update(shim).digest('hex')})).digest('hex');
let header = `// Generated by tools/build-trig-native-package.mjs. Do not edit.\n// Canonical source: runtime/trig; see runtime/LICENSE-musl.txt.\n// Source/toolchain identity: ${sourceIdentity}\n#pragma once\n#include <cstdint>\n#include <cstddef>\nnamespace vkf::trig::native_package {\ninline constexpr char source_identity[] = "${sourceIdentity}";\nstruct Image { const std::uint8_t* bytes; std::size_t size; std::uint32_t sine_offset, cosine_offset, alignment; };\n`;
packages.forEach((target, index) => {
  const data = [...images[index]].map((byte, offset) => `${offset % 20 === 0 ? '\n ' : ''}0x${byte.toString(16).padStart(2, '0')},`).join('');
  header += `inline constexpr std::uint8_t ${target.name}_bytes[] = {${data}\n};\n`;
  header += `inline constexpr Image ${target.name} {${target.name}_bytes,sizeof(${target.name}_bytes),${target.entryOffsets.sin},${target.entryOffsets.cos},${target.name === 'arm64' ? 4096 : 16}};\n`;
});
header += '} // namespace vkf::trig::native_package\n';
const destination = 'compiler/native/runtime/vkf_trig_native.generated.hpp';
if (process.argv.includes('--check')) assert.equal(readFileSync(destination, 'utf8').replace(/\r\n/g, '\n'), header);
else writeFileSync(destination, header);
writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify({
  policy:'vkf-trig-v1', status:'uninstalled-package', compiler:version.trim(), flags,
  hashes, sourceIdentity, freestandingShimSha256:createHash('sha256').update(shim).digest('hex'), packages,
}, null, 2));
console.log(JSON.stringify({directory, packages}));
