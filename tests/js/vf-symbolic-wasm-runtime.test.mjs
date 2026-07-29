import assert from "node:assert/strict";
import test from "node:test";

import {
  SYMBOLIC_TEXT_WASM_ABI_EXPORTS,
  createSymbolicWasmTextChannel,
} from "../../web/vf-ui/vf-symbolic-wasm-runtime.mjs";

function createMockAbi(capacity = 128) {
  const memory = new WebAssembly.Memory({ initial: 1 });
  const inputPointer = 64;
  const outputPointer = inputPointer + capacity;
  let inputLength = 0;
  let outputLength = 0;

  const exports = {
    memory,
    vkf_symbolic_input_ptr: () => inputPointer,
    vkf_symbolic_input_capacity: () => capacity,
    vkf_symbolic_input_len: () => inputLength,
    vkf_symbolic_set_input_len(length) {
      inputLength = Math.min(length, capacity);
      return inputLength;
    },
    vkf_symbolic_output_ptr: () => outputPointer,
    vkf_symbolic_output_capacity: () => capacity,
    vkf_symbolic_output_len: () => outputLength,
    vkf_symbolic_trace() {
      const input = new Uint8Array(memory.buffer, inputPointer, inputLength);
      new Uint8Array(memory.buffer, outputPointer, inputLength).set(input);
      outputLength = inputLength;
      return outputLength;
    },
  };

  return { exports };
}

test("declares the emitted VKF symbolic text ABI", () => {
  assert.deepEqual(SYMBOLIC_TEXT_WASM_ABI_EXPORTS, [
    "memory",
    "vkf_symbolic_input_ptr",
    "vkf_symbolic_input_capacity",
    "vkf_symbolic_input_len",
    "vkf_symbolic_set_input_len",
    "vkf_symbolic_output_ptr",
    "vkf_symbolic_output_capacity",
    "vkf_symbolic_output_len",
    "vkf_symbolic_trace",
  ]);
});

test("moves UTF-8 through WASM without interpreting it in JavaScript", () => {
  const mock = createMockAbi();
  const channel = createSymbolicWasmTextChannel(mock.exports);

  assert.equal(channel.transfer("pi + räksmörgås"), "pi + räksmörgås");
});

test("allows a generated VKF operation export to own the transformation", () => {
  const mock = createMockAbi();
  const channel = createSymbolicWasmTextChannel(mock.exports);
  const operation = () => {
    mock.exports.vkf_symbolic_trace();
    const pointer = mock.exports.vkf_symbolic_output_ptr();
    new Uint8Array(mock.exports.memory.buffer, pointer, 1)[0] = "X".charCodeAt(0);
  };

  assert.equal(channel.transfer("x + y", operation), "X + y");
});

test("rejects incomplete ABIs, non-text input, and overflowing input", () => {
  assert.throws(
    () => createSymbolicWasmTextChannel({ memory: new WebAssembly.Memory({ initial: 1 }) }),
    /vkf_symbolic_input_ptr/,
  );

  const channel = createSymbolicWasmTextChannel(createMockAbi(4).exports);
  assert.throws(() => channel.transfer(42), /requires a string/);
  assert.throws(() => channel.transfer("longer"), /invalid WASM memory range|exceeds/);
});
