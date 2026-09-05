// Transport only. Parsing, typing, lowering and execution are owned by WASM.
// This adapter is not connected to the published runner until parity passes.
export function createSharedCompiler({instance}) {
  const api = instance.exports;
  api._initialize?.();
  function response() {
    return JSON.parse(new TextDecoder().decode(new Uint8Array(api.memory.buffer,
      api.vkf_result_pointer(), api.vkf_result_length())));
  }
  function withSource(source, callback) {
    if (typeof source !== 'string') throw new TypeError('browser compiler source must be a string');
    const bytes = new TextEncoder().encode(source);
    const pointer = api.malloc(bytes.length + 1);
    if (!pointer) throw new Error('browser compiler source allocation failed');
    try {
      new Uint8Array(api.memory.buffer, pointer, bytes.length).set(bytes);
      return callback(pointer, bytes.length);
    } finally { api.free(pointer); }
  }
  function checkedResponse(status, phase = 'discovery') {
      const result = response();
      if (status !== 0) {
        const error = new Error(result.message);
        error.phase = phase;
        throw error;
      }
      return result;
  }
  function compile(source) {
    return withSource(source, (pointer, length) => checkedResponse(api.vkf_compile_source(pointer, length), 'frontend'));
  }
  return Object.freeze({
    compile,
    describeTests(source, identity = '<browser>') {
      return withSource(source, (pointer, length) => withSource(identity, (identityPointer, identityLength) =>
        checkedResponse(api.vkf_describe_tests(pointer, length, identityPointer, identityLength))));
    },
    selectTestFiles(paths) {
      return withSource(JSON.stringify(paths), (pointer, length) =>
        checkedResponse(api.vkf_select_test_files(pointer, length))).files;
    },
    run(source) {
      compile(source);
      const status = api.vkf_emit_program();
      const result = checkedResponse(status, 'lowering');
      const module = new WebAssembly.Module(new Uint8Array(api.memory.buffer,
        api.vkf_program_pointer(), api.vkf_program_length()));
      if (WebAssembly.Module.imports(module).length !== 0) {
        throw new Error('compiled browser program must not import host capabilities');
      }
      const programInstance = new WebAssembly.Instance(module);
      const programApi = programInstance.exports;
      if (result.manifest?.schema !== 'vektor-flow.symbolic-kernel'
          || !result.manifest.functions || typeof result.manifest.functions !== 'object') {
        throw new TypeError('invalid VKF symbolic kernel manifest');
      }
      const entry = result.manifest.functions.$vkf_main;
      if (!entry) throw new RangeError('unknown VKF function "$vkf_main"');
      if (entry.parameters !== 0) {
        throw new RangeError(`$vkf_main expects ${entry.parameters} arguments, got 0`);
      }
      // Entry metadata and opaque addresses are transport. Never decode a VKF value.
      const invocationStatus = programApi.vkf_vm_invoke(entry.index, 0);
      if (invocationStatus !== 0) {
        throw new Error(`VKF invocation "$vkf_main" failed with status ${invocationStatus}`);
      }
      // Copy raw slots, preserving relative pointers and every numeric bit.
      // Native display formatting executes in the compiler WASM, not JavaScript.
      const used = Math.max(programApi.vkf_vm_heap_ptr(),
        programApi.vkf_vm_results_ptr() + programApi.vkf_vm_value_slot_size());
      const memory = new Uint8Array(programApi.memory.buffer, 0, used);
      const pointer = api.malloc(memory.length);
      if (!pointer) throw new Error('browser compiler stdout allocation failed');
      try {
        new Uint8Array(api.memory.buffer, pointer, memory.length).set(memory);
        const formatted = checkedResponse(api.vkf_format_stdout(pointer, memory.length,
          programApi.vkf_vm_results_ptr()), 'output');
        return {kind: 'console', stdout: formatted.stdout, stderr: ''};
      } finally { api.free(pointer); }
    },
  });
}
