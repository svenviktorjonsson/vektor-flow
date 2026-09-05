# Shared record-call parity — 2026-09-05

Base: dirty `main` at `67343be7e279c3e6ad65331df2490d7aa7605d2e`.
This receipt covers the private inferred-record argument adapter, not full
language, README, UI, bootstrap, or deployment acceptance.

## RED boundary

The preceding shared artifact passed 13 of the 14 unchanged native block tests.
`any_record_field_inference_propagates_call_shape` trapped with an out-of-bounds
memory access. The native compiler passed the same source. The two additional
native differential probes printed `99\n5\n` (one effectful argument producer)
and `5\n3\n` (record inference alongside linked math); the old WASM execution
also trapped. These are the preserved predecessor checkpoint results, not a
fresh replay against the new artifact.

## Implementation boundary

The shared native layout inference owns argument shape decisions. Its borrowed
pointers refer to an owning canonical IR value inside the typed module, not
temporary or compiler-private output nodes. At an applicable call, a fixed
numeric array is evaluated once, stored, and reconstructed into the inferred
record layout using existing array/object instructions. No source-name match,
field-access fallback, new public syntax, schema, ABI, or evaluation order was
introduced. Non-applicable representations retain their existing behavior;
broader record coverage is not claimed.

## GREEN and regression

Environment: Windows host, Docker `node:22-bookworm`, Node 22 and GCC 12.
Shared compiler build: `emscripten/emsdk:4.0.14`, integration-owned combined build.

Commands inside the repository mounted at `/src`:

```sh
node --test tests/bootstrap/shared-scope-execution.test.mjs \
  tests/bootstrap/shared-call-execution.test.mjs
node --test tests/bootstrap/shared-record-argument-plan.test.mjs \
  tests/bootstrap/shared-default-call-thunk.test.mjs
```

- Scope/call: exit 0, 23 passed, 0 failed, 0 skipped, 2.230 seconds.
- All 14 canonical block assertions pass unchanged on native and WASM.
- Both added record probes match exact native stdout and repeat execution.
- Named/mixed calls, callee-scoped defaults, and supplied failing-default
  suppression remain green.
- Record-plan/default-thunk: exit 0, 4 passed, 0 failed, 0 skipped, 4.932 seconds.
- Scoped `git diff --check`: exit 0.

SHA256:

| Input/artifact | Hash |
| --- | --- |
| Shared compiler WASM | `48877b14299fe4028416f24996672d035d73488e24c5fb7a0d71ff63618cf6f5` |
| Native compiler | `70b5795a2d1a9b22659b7e3c53ead08f03a0160dc57adb32d0832183701e1b05` |
| Record argument plan header | `aca316caef5da1fe2bdfcf0a3d9d4a5e22f0bad425de605e8ea04eb13d77eac5` |
| Combined bytecode lowerer header | `e8426485d7697b5fe06e60282a387610dd8471ad16aba30277e7e6f33acdbe9a` |

The combined lowerer includes other integration-owned packets. This receipt
does not attribute their correctness to the record tests or claim performance
improvements from test durations. Nothing was committed, pushed, or deployed by
this verifier.
