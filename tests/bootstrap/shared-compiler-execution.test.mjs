import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createSymbolicKernel } from '../../web/vf-ui/vf-symbolic-kernel-runtime.mjs';

test('shared browser compiler generates executable WASM from edited function source', async () => {
  const module = new WebAssembly.Module(await readFile(new URL(
    '../../build/shared-compiler/vkf-compiler.wasm', import.meta.url)));
  assert.deepEqual(WebAssembly.Module.imports(module), []);
  const compiler = (await WebAssembly.instantiate(module)).exports;
  compiler._initialize?.();
  const emittedBySource = new Map();
  async function run(source, argument) {
    const bytes = new TextEncoder().encode(source);
    const pointer = compiler.malloc(bytes.length);
    try {
      new Uint8Array(compiler.memory.buffer, pointer, bytes.length).set(bytes);
      assert.equal(compiler.vkf_compile_source(pointer, bytes.length), 0);
      const status = compiler.vkf_emit_program();
      const response = JSON.parse(new TextDecoder().decode(new Uint8Array(
        compiler.memory.buffer, compiler.vkf_result_pointer(), compiler.vkf_result_length())));
      assert.equal(status, 0, response.message);
      const programBytes = new Uint8Array(compiler.memory.buffer,
        compiler.vkf_program_pointer(), compiler.vkf_program_length()).slice();
      if (emittedBySource.has(source)) {
        assert.deepEqual(programBytes, emittedBySource.get(source), 'repeat emission must be byte-identical');
      }
      emittedBySource.set(source, programBytes);
      const program = new WebAssembly.Module(programBytes);
      assert.deepEqual(WebAssembly.Module.imports(program), []);
      const instance = await WebAssembly.instantiate(program);
      assert.equal(instance.exports.vkf_vm_heap_limit() - instance.exports.vkf_vm_heap_base(),
        64 * 1024 * 1024, 'use the same program arena capacity as the native artifact builder');
      return createSymbolicKernel({instance, manifest: response.manifest})
        .invokeValue('square', [argument]);
    } finally {
      compiler.free(pointer);
    }
  }
  assert.equal(await run('square(value:num) -> num: value * value\n', 7), 49);
  assert.equal(await run('square(value:num) -> num: value * value + 1\n', 7), 50);
  assert.equal(await run('square(value:num) -> num: value * value\n', 7), 49);
});

test('top-level program statements execute instead of producing an empty successful program', async () => {
  const module = new WebAssembly.Module(await readFile(new URL(
    '../../build/shared-compiler/vkf-compiler.wasm', import.meta.url)));
  const compiler = (await WebAssembly.instantiate(module)).exports;
  compiler._initialize?.();
  for (const source of [':: 42\n', 'value: 42\n:: value\n']) {
    const bytes = new TextEncoder().encode(source);
    const pointer = compiler.malloc(bytes.length);
    try {
      new Uint8Array(compiler.memory.buffer, pointer, bytes.length).set(bytes);
      assert.equal(compiler.vkf_compile_source(pointer, bytes.length), 0);
      assert.equal(compiler.vkf_emit_program(), 0);
      const response = JSON.parse(new TextDecoder().decode(new Uint8Array(
        compiler.memory.buffer, compiler.vkf_result_pointer(), compiler.vkf_result_length())));
      assert.equal(response.ok, true);
      const program = new WebAssembly.Module(new Uint8Array(compiler.memory.buffer,
        compiler.vkf_program_pointer(), compiler.vkf_program_length()).slice());
      const kernel = createSymbolicKernel({instance: await WebAssembly.instantiate(program), manifest: response.manifest});
      assert.deepEqual(kernel.invokeValue('$vkf_main', []), [42], 'do not silently discard top-level work');
    } finally {
      compiler.free(pointer);
    }
  }
});

test('failed compilation invalidates old program bytes and a subsequent compilation recovers', async () => {
  const module = new WebAssembly.Module(await readFile(new URL(
    '../../build/shared-compiler/vkf-compiler.wasm', import.meta.url)));
  const compiler = (await WebAssembly.instantiate(module)).exports;
  compiler._initialize?.();
  function compile(source) {
    const bytes = new TextEncoder().encode(source);
    const pointer = compiler.malloc(bytes.length);
    try {
      new Uint8Array(compiler.memory.buffer, pointer, bytes.length).set(bytes);
      return compiler.vkf_compile_source(pointer, bytes.length);
    } finally {
      compiler.free(pointer);
    }
  }
  const valid = 'square(value:num) -> num: value * value\n';
  assert.equal(compile(valid), 0);
  assert.equal(compiler.vkf_emit_program(), 0);
  const expected = new Uint8Array(compiler.memory.buffer,
    compiler.vkf_program_pointer(), compiler.vkf_program_length()).slice();
  assert.ok(expected.length > 0);
  assert.equal(compile('value: ('), 1);
  assert.equal(compiler.vkf_program_length(), 0);
  assert.equal(compiler.vkf_emit_program(), 1);
  assert.equal(compiler.vkf_program_length(), 0);
  assert.equal(compile(valid), 0);
  assert.equal(compiler.vkf_emit_program(), 0);
  assert.deepEqual(new Uint8Array(compiler.memory.buffer,
    compiler.vkf_program_pointer(), compiler.vkf_program_length()), expected);
});
