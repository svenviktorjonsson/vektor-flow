# Shared compiler inline-worker tracer

Date: 2026-09-06

Base: `05e33480 fix(wasm): snapshot UI effect operands`

The production inline worker now instantiates the import-free shared C++
compiler WASM and calls `createSharedCompiler`. The deployed artifact is the
same byte sequence as `build/shared-compiler/vkf-compiler.wasm` (SHA-256
`a2d0aa85a01f408eca0b61880f6f0121be258909c21ca63cdcf92b559eb28709`).
The worker no longer calls the legacy self-hosted JavaScript adapter.

The tracer uses the unchanged first linked-guide example,
`core/01-bindings.vkf`. Through the actual worker request path it verifies:

- canonical source emits exactly `7\n6\n` in one compiler-formatted console
  result;
- editing `value: 3` to `value: 5` emits exactly `9\n10\n`;
- restoring canonical source emits exactly `7\n6\n` again;
- the loaded compiler module has zero WebAssembly imports;
- JavaScript never decodes or simulates a VKF value and no fallback runs.

RED was the missing `runInlineWorkerRequest` production entry. GREEN is 1/1.
The focused production runner/controller suite is 38/38. End-to-end shared
compiler coverage is now 1/87 README and linked-guide examples (1.15%). The
next gate is one complete 87-example execution census, clustered by exact
failure phase and diagnostic.
