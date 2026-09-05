import assert from 'node:assert/strict';
import {mkdtemp, readFile, writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../../', import.meta.url));
const directory = await mkdtemp(join(root, 'build/trig-package-test-'));
const source = join(directory, 'package.cpp');
const executable = join(directory, 'package');
await writeFile(source, String.raw`
#include "compiler/native/vkf_wasm_vm_emitter.hpp"
#include "compiler/native/vkf_wasm_trig_package.hpp"
#include <fstream>
int main(int argc, char** argv) {
    using namespace vkf::wasm::vm::detail;
    namespace package = vkf::wasm::trig_package;
    const unsigned prefix = argc > 2 ? 130 : 0;
    const unsigned global_prefix = argc > 2 ? 131 : 0;
    const unsigned memory_base = argc > 2 ? 8192 : 1024;
    Writer module;
    for (auto byte : {0x00,0x61,0x73,0x6d,0x01,0x00,0x00,0x00}) module.u8(byte);
    Writer types; types.u32_leb(prefix + package::function_count);
    for (unsigned i=0; i<prefix; ++i) { types.u8(0x60); types.u32_leb(0); types.u32_leb(0); }
    package::append_types(types); append_section(module,1,types.take());
    Writer functions; functions.u32_leb(prefix + package::function_count);
    for (unsigned i=0; i<prefix + package::function_count; ++i) functions.u32_leb(i);
    append_section(module,3,functions.take());
    Writer memory; memory.u32_leb(1); memory.u8(0); memory.u32_leb(2);
    append_section(module,5,memory.take());
    Writer globals; globals.u32_leb(global_prefix + 2);
    for (unsigned i=0; i<global_prefix + 2; ++i) {
        globals.u8(0x7f); globals.u8(i == global_prefix ? 1 : 0);
        i32_const(globals, i == global_prefix ? memory_base + package::data_bytes + package::stack_bytes
            : i == global_prefix + 1 ? memory_base : 0); globals.u8(0x0b);
    }
    append_section(module,6,globals.take());
    Writer exports; exports.u32_leb(4);
    exports.name("sin"); exports.u8(0); exports.u32_leb(prefix + package::generated::sine_index);
    exports.name("cos"); exports.u8(0); exports.u32_leb(prefix + package::generated::cosine_index);
    exports.name("memory"); exports.u8(2); exports.u32_leb(0);
    exports.name("stack"); exports.u8(3); exports.u32_leb(global_prefix);
    append_section(module,7,exports.take());
    Writer code; code.u32_leb(prefix + package::function_count);
    for (unsigned i=0; i<prefix; ++i) { code.u32_leb(2); code.u8(0); code.u8(0x0b); }
    package::append_code(code,prefix,global_prefix,global_prefix+1);
    append_section(module,10,code.take());
    Writer data; data.u32_leb(1); data.u32_leb(0); i32_const(data,memory_base); data.u8(0x0b);
    data.u32_leb(package::data_bytes); data.raw(package::generated::static_data,package::data_bytes);
    append_section(module,11,data.take());
    const auto bytes=module.take(); std::ofstream output(argv[1],std::ios::binary);
    output.write(reinterpret_cast<const char*>(bytes.data()),bytes.size());
}
`);
const compiled = spawnSync(process.env.CXX ?? 'g++', ['-std=c++17', '-O0', '-I'+root, source, '-o', executable],
  {encoding:'utf8', timeout:120_000});
assert.equal(compiled.status, 0, compiled.stderr);

test('compiler-owned trig relocation preserves every audited result without host imports', async () => {
  const original = JSON.parse(await readFile(join(root, 'build/trig-candidate/observations.json'), 'utf8'));
  assert.equal(original.policy, 'vkf-trig-v1-candidate');
  assert.equal(original.rows.length, 12793, 'run the complete frozen candidate sample');
  for (const shifted of [false, true]) {
    const artifact = join(directory, shifted ? 'shifted.wasm' : 'base.wasm');
    const generated = spawnSync(executable, [artifact, ...(shifted ? ['shifted'] : [])],
      {encoding:'utf8', timeout:30_000});
    assert.equal(generated.status, 0, generated.stderr);
    const module = new WebAssembly.Module(await readFile(artifact));
    assert.deepEqual(WebAssembly.Module.imports(module), []);
    const api = new WebAssembly.Instance(module).exports;
    const initialStack = api.stack.value;
    for (const row of original.rows) {
      const x = Buffer.from(row.input, 'hex').readDoubleBE();
      assert.equal(api.sin(x), Buffer.from(row.wasmSin, 'hex').readDoubleBE(), `sin ${row.input}, shifted=${shifted}`);
      assert.equal(api.cos(x), Buffer.from(row.wasmCos, 'hex').readDoubleBE(), `cos ${row.input}, shifted=${shifted}`);
      assert.equal(api.stack.value, initialStack, 'private stack must be restored after each call');
    }
  }
});
