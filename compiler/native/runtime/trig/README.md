# Portable trig candidate

Not yet connected to production. Implements private `vkf_trig_v1_sin` and
`vkf_trig_v1_cos` from the musl math sources bundled in
`emscripten/emsdk:4.0.14`. Original Sun notices remain in the six trig/reduction
files; the musl MIT notice for the complete work (including floor/scalbn) is
[`../LICENSE-musl.txt`](../LICENSE-musl.txt).

Adaptation is limited to the include shim: private-prefixed names, binary64-only
evaluation check and exact bit access. Argument-reduction tables, coefficients
and arithmetic are retained. Floor/scalbn dependencies are also bundled, not
delegated to host libm. The original floor source uses a WASM floor instruction
and portable native arithmetic; measured numerical parity is required.

Build only through `node tools/build-trig-candidate.mjs` in Emscripten 4.0.14.
Flags disable contraction, fast math, builtins and excess precision. The build
writes a versioned source-hash manifest under `build/trig-candidate`.
`tools/audit-trig-candidate.mjs` compares native/WASM on the prior frozen audit
inputs; `tools/audit-shared-trigonometry.py` measures high-precision error.

This is a sampled near-rounded candidate, not a correctly-rounded implementation
claim. It improves current WASM accuracy but is not more accurate than glibc on
the measured sample. Integration must cover native runners, PE/ARM64 dispatch,
constant evaluators and emitted WASM without ABI or diagnostic changes.
