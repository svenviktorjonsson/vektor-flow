// Compiler-owned package generation. Never rebuilds a production compiler.
import assert from 'node:assert/strict';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';

const directory = 'build/trig-runtime-package';
mkdirSync(directory, {recursive:true});
const names = ['sin.c', 'cos.c', '__sin.c', '__cos.c', '__rem_pio2.c', '__rem_pio2_large.c', 'scalbn.c', 'floor.c'];
const sources = names.map(name => 'compiler/native/runtime/trig/' + name);
const flags = ['-std=c11', '-O2', '-ffp-contract=off', '-fno-fast-math', '-fno-builtin', '-fexcess-precision=standard', '-ffreestanding'];
const identitySources = [...sources, 'compiler/native/runtime/trig/vkf_trig_internal.h'];
const hashes = Object.fromEntries(identitySources
  .map(file => [file, createHash('sha256').update(readFileSync(file, 'utf8').replace(/\r\n/g, '\n')).digest('hex')]));
const sourceIdentity = createHash('sha256').update(JSON.stringify({hashes, flags, compiler:'emscripten-4.0.14'})).digest('hex');
function run(command, args) {
  const result = spawnSync(command, args, {encoding:'utf8', timeout:120_000});
  assert.equal(result.status, 0, result.stderr ?? result.error?.message);
  return result.stdout;
}
assert.match(run('emcc', ['--version']), /4\.0\.14/);
const artifact = directory + '/trig-side.wasm';
run('emcc', [...flags, ...sources, '-sSIDE_MODULE=2',
  '-sEXPORTED_FUNCTIONS=["_vkf_trig_v1_sin","_vkf_trig_v1_cos"]', '-o', artifact]);
const module = new WebAssembly.Module(readFileSync(artifact));
const imports = WebAssembly.Module.imports(module);
const exports = WebAssembly.Module.exports(module);
// No external math functions are allowed even in this intermediate package.
assert.ok(imports.every(item => item.module === 'env' &&
  ((item.kind === 'memory' && item.name === 'memory') ||
   (item.kind === 'global' && ['__memory_base', '__stack_pointer'].includes(item.name)))),
JSON.stringify(imports));
class Reader {
  constructor(bytes) { this.bytes = bytes; this.pos = 0; }
  byte() { assert.ok(this.pos < this.bytes.length, 'truncated WASM'); return this.bytes[this.pos++]; }
  uleb() { let value = 0, shift = 0, byte; do { byte = this.byte(); value += (byte & 127) * 2 ** shift; shift += 7; } while (byte & 128); return value; }
  leb() { let byte; do { byte = this.byte(); } while (byte & 128); }
  take(size) { assert.ok(this.pos + size <= this.bytes.length, 'truncated WASM'); const result = this.bytes.subarray(this.pos, this.pos + size); this.pos += size; return result; }
  name() { return this.take(this.uleb()).toString(); }
}
const reader = new Reader(readFileSync(artifact)); reader.take(8);
const sections = new Map();
let memorySize;
while (reader.pos < reader.bytes.length) {
  const id = reader.byte(), bytes = reader.take(reader.uleb());
  if (id) sections.set(id, bytes);
  else {
    const custom = new Reader(bytes);
    if (custom.name() === 'dylink.0') {
      while (custom.pos < bytes.length) {
        const kind = custom.byte(), info = new Reader(custom.take(custom.uleb()));
        if (kind === 1) {
          memorySize = info.uleb(); const alignment = info.uleb();
          assert.ok(alignment <= 4); assert.equal(info.uleb(), 0, 'unexpected table storage'); info.uleb();
        }
      }
    }
  }
}
assert.ok(Number.isInteger(memorySize));
assert.ok(!sections.has(6), 'unexpected defined globals');
assert.ok(!sections.has(8), 'unexpected start function');
assert.ok(!sections.has(9), 'unexpected element table');
const imported = new Reader(sections.get(2));
const globals = [];
for (let count = imported.uleb(); count; --count) {
  assert.equal(imported.name(), 'env');
  const name = imported.name(), kind = imported.byte();
  if (kind === 3) {
    assert.equal(imported.byte(), 0x7f); const mutable = imported.byte();
    assert.equal(mutable, name === '__stack_pointer' ? 1 : 0);
    globals.push(name);
  } else {
    assert.equal(kind, 2); assert.equal(name, 'memory');
    const flags = imported.uleb(); imported.uleb(); if (flags & 1) imported.uleb();
    assert.ok(flags < 2, 'unexpected shared or memory64 import');
  }
}
const typesReader = new Reader(sections.get(1)), types = [];
for (let count = typesReader.uleb(); count; --count) {
  const start = typesReader.pos;
  assert.equal(typesReader.byte(), 0x60);
  const params = [...typesReader.take(typesReader.uleb())];
  const results = [...typesReader.take(typesReader.uleb())];
  assert.ok([...params, ...results].every(type => [0x7f, 0x7e, 0x7d, 0x7c].includes(type)));
  types.push(typesReader.bytes.subarray(start, typesReader.pos));
}
const signatures = new Reader(sections.get(3)), functionTypes = [];
for (let count = signatures.uleb(); count; --count) functionTypes.push(signatures.uleb());
const exported = new Reader(sections.get(7)), entries = {};
for (let count = exported.uleb(); count; --count) {
  const name = exported.name(); assert.equal(exported.byte(), 0);
  entries[name] = exported.uleb();
}
const code = new Reader(sections.get(10)), functions = [];
for (let count = code.uleb(); count; --count) {
  const body = new Reader(code.take(code.uleb())), relocations = [];
  for (let locals = body.uleb(); locals; --locals) { body.uleb(); body.byte(); }
  while (body.pos < body.bytes.length) {
    const op = body.byte();
    if ([0x02, 0x03, 0x04].includes(op)) {
      assert.ok([0x40, 0x7f, 0x7e, 0x7d, 0x7c].includes(body.byte()), 'unexpected block signature');
    } else if ([0x10, 0x23, 0x24].includes(op)) {
      const offset = body.pos, value = body.uleb();
      const kind = op === 0x10 ? 0 : globals[value] === '__stack_pointer' ? 1 : 2;
      if (op !== 0x10) assert.ok(globals[value], 'unknown global');
      else assert.ok(value < functionTypes.length, 'external call');
      relocations.push({offset, width:body.pos - offset, kind, value});
    } else if ([0x0c, 0x0d, 0x20, 0x21, 0x22].includes(op)) body.uleb();
    else if (op === 0x0e) { const size = body.uleb(); for (let i = 0; i <= size; i++) body.uleb(); }
    else if (op >= 0x28 && op <= 0x3e) { body.uleb(); body.uleb(); }
    else if (op === 0x3f || op === 0x40) assert.equal(body.byte(), 0);
    else if (op === 0x41 || op === 0x42) body.leb();
    else if (op === 0x43) body.take(4);
    else if (op === 0x44) body.take(8);
    else if (op === 0xfc) assert.ok(body.uleb() <= 7, 'unexpected bulk-memory instruction');
    else assert.ok([0x00, 0x01, 0x05, 0x0b, 0x0f, 0x1a, 0x1b].includes(op) || (op >= 0x45 && op <= 0xc4),
      `unsupported package opcode 0x${op.toString(16)}`);
  }
  functions.push({bytes:body.bytes, relocations});
}
assert.equal(functions.length, functionTypes.length);
assert.ok(Number.isInteger(entries.vkf_trig_v1_sin) && Number.isInteger(entries.vkf_trig_v1_cos));
assert.deepEqual([...functions[entries.__wasm_call_ctors].bytes], [0, 0x0b],
  'package initialization must remain empty');
const data = new Reader(sections.get(11)), staticData = Buffer.alloc(memorySize);
assert.equal(data.uleb(), 1, 'unexpected number of static data segments');
{
  assert.equal(data.uleb(), 0, 'unexpected data segment mode');
  assert.equal(data.byte(), 0x23); assert.equal(globals[data.uleb()], '__memory_base');
  assert.equal(data.byte(), 0x0b);
  const bytes = data.take(data.uleb()); assert.ok(bytes.length <= memorySize); bytes.copy(staticData);
}
const format = bytes => [...bytes].map((byte, index) => `${index % 20 === 0 ? '\n ' : ''}0x${byte.toString(16).padStart(2, '0')},`).join('');
let header = `// Generated by tools/build-trig-runtime-package.mjs. Do not edit.\n// Licensed canonical sources: runtime/trig; see runtime/LICENSE-musl.txt.\n// Emscripten 4.0.14; canonical source/flags identity: ${sourceIdentity}\n#pragma once\n#include <cstdint>\n#include <cstddef>\nnamespace vkf::wasm::trig_package::generated {\ninline constexpr char source_identity[] = "${sourceIdentity}";\nstruct Relocation { std::uint32_t offset, width, kind, value; };\nstruct Function { const std::uint8_t* type; std::size_t type_size; const std::uint8_t* body; std::size_t body_size; const Relocation* relocations; std::size_t relocation_count; };\n`;
functions.forEach((fn, index) => {
  header += `inline constexpr std::uint8_t type_${index}[] = {${format(types[functionTypes[index]])}};\n`;
  header += `inline constexpr std::uint8_t body_${index}[] = {${format(fn.bytes)}};\n`;
  header += `inline constexpr Relocation relocations_${index}[] = {${fn.relocations.length ? fn.relocations.map(r => `{${r.offset},${r.width},${r.kind},${r.value}},`).join('') : '{0,0,0,0}'}};\n`;
});
header += `inline constexpr Function functions[] = {\n${functions.map((fn, index) => ` {type_${index},sizeof(type_${index}),body_${index},sizeof(body_${index}),relocations_${index},${fn.relocations.length}},`).join('\n')}\n};\n`;
header += `inline constexpr std::uint32_t sine_index = ${entries.vkf_trig_v1_sin};\ninline constexpr std::uint32_t cosine_index = ${entries.vkf_trig_v1_cos};\n`;
header += `inline constexpr std::uint8_t static_data[] = {${format(staticData)}};\n}\n`;
const destination = 'compiler/native/runtime/vkf_trig_wasm.generated.hpp';
if (process.argv.includes('--check')) assert.equal(readFileSync(destination, 'utf8').replace(/\r\n/g, '\n'), header);
else writeFileSync(destination, header);
writeFileSync(directory + '/manifest.json', JSON.stringify({
  policy:'vkf-trig-v1', status:'uninstalled-package', flags, hashes, sourceIdentity, imports, exports,
  artifactSha256:createHash('sha256').update(readFileSync(artifact)).digest('hex'),
}, null, 2));
console.log(JSON.stringify({directory, imports, exports}));
