import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {createSymbolicKernel} from '../../web/vf-ui/vf-symbolic-kernel-runtime.mjs';

test('whole source executes binding updates and prints in source order', async () => {
  const bytes = await readFile(new URL('../../build/shared-compiler/vkf-compiler.wasm', import.meta.url));
  const module = new WebAssembly.Module(bytes);
  assert.deepEqual(WebAssembly.Module.imports(module), []);
  const compiler = (await WebAssembly.instantiate(module)).exports;
  compiler._initialize?.();
  async function run(source) {
    const native = spawnSync(fileURLToPath(new URL('../../build/native-compiler-docker/bin/vkf-strict', import.meta.url)),
      ['-e', source], {encoding: 'utf8', timeout: 30000, windowsHide: true});
    assert.equal(native.error, undefined, native.error?.message);
    assert.equal(native.status, 0, native.stderr);
    const encoded = new TextEncoder().encode(source);
    const pointer = compiler.malloc(encoded.length);
    try {
      new Uint8Array(compiler.memory.buffer, pointer, encoded.length).set(encoded);
      assert.equal(compiler.vkf_compile_source(pointer, encoded.length), 0);
      const status = compiler.vkf_emit_program();
      const result = JSON.parse(new TextDecoder().decode(new Uint8Array(compiler.memory.buffer,
        compiler.vkf_result_pointer(), compiler.vkf_result_length())));
      assert.equal(status, 0, result.message);
      const program = new WebAssembly.Module(new Uint8Array(compiler.memory.buffer,
        compiler.vkf_program_pointer(), compiler.vkf_program_length()).slice());
      assert.deepEqual(WebAssembly.Module.imports(program), []);
      const kernel = createSymbolicKernel({instance: await WebAssembly.instantiate(program), manifest: result.manifest});
      const first = kernel.invokeValue('$vkf_main', []);
      assert.deepEqual(kernel.invokeValue('$vkf_main', []), first, 'each execution resets output');
      assert.equal(first.map(value => String(value)).join('\n') + '\n', native.stdout,
        'integer console values match the native executable byte-for-byte');
      return first;
    } finally { compiler.free(pointer); }
  }
  assert.deepEqual(await run('value: 7\n:: value\n.value: value - 1\n:: value\n'), [7, 6]);
  assert.deepEqual(await run('value: 9\n:: value\n.value: value - 1\n:: value\n'), [9, 8]);
  assert.deepEqual(await run('emit(value:num) -> num:\n    :: value\n    value + 1\n\n:: emit(2)\n:: emit(4)\n'),
    [2, 3, 4, 5], 'nested calls emit output in evaluation order');
});
