# Complete private scalar-entry bytes

Baseline: bootstrap `f171d1e179edd94a205febf91be86513a0ef8f93`.
This packet completes the earlier partial prefix for a scalar-constant entry.
The resulting byte array is compared to native but **never executed**. There
is no executable container, runtime adapter, source-to-module composition, or
compiler-successor claim.

## RED to GREEN

`stage1-private-x64-prefix.test.mjs` retains every prefix assertion and adds
an exact comparison of the complete private entry against the complete output
already produced by the unchanged native emitter oracle.

The new runtime-input entry call first failed **0/1**, 1084.6318 ms, with
`direct x64 backend unsupported: machine IR supports direct calls only`.
After implementation, the same test passed **1/1**, 1848.5612 ms.

`_bootstrap_x64_entry_constant` reuses `_bootstrap_x64_entry_prefix` unchanged,
then follows the existing native `ReturnF64` path: load the result, restore the
runtime context, restore saved registers, and emit `leave; ret`. Relevant
baseline code is `vkf_x64_artifact.cpp:13383` and `epilogue` at line 2689.
No extra register, slot, ownership rule, or calling convention is introduced.

The native oracle, its build target, and all earlier helper bodies are
unchanged. Invalid frames retain empty-byte private failure results. The same
varied locals/stack/literal and stack-page-boundary cases now compare both the
partial prefix and the complete entry array. This remains the no-parameter,
no-owned-local, no-scratch, non-error frame described in
`050-private-x64-entry-prefix.md`. Windows x64 is the verified target; no
SysV or ARM64 gate is promoted.

## Regression and visibility

Use the environment and test commands in `050-private-x64-entry-prefix.md`.
The expanded test preserves the original prefix oracle and adds complete-entry
assertions; neither native nor private generated machine code is executed.

Full unchanged checkpoint: **25/25**, exit 0, 72981.9169 ms. Full bundle in
that run: 12684.5212 ms; locked graph: 10257.8283 ms. Timings are receipts,
not performance claims. No tolerance, timeout, or acceptance gate was weakened.
A second unchanged full-bundle run passed **1/1**, exit 0, 11698.8542 ms
total (11617.1074 ms in the test).

Every prior helper body compares exactly to baseline. The canonical I94 lock
refresh changes only the machine source and ordered bundle hashes.
`node tools/build-browser-compiler.mjs --output build/private-parser-visibility/x64-entry-output`
produces public WASM and manifest exactly equal to the untouched archived
baseline under `build/private-parser-visibility/baseline-output`. No private
helper is exported. Shipped browser artifacts were not changed or deployed.

| Identity | SHA-256 |
| --- | --- |
| Machine source, canonical LF | `7a695f230f0a347d1a7abf1d207bf6c046f1bbe97c8467e91aa71556579e61d7` |
| Bootstrap manifest, canonical LF | `407b953e091154505efb2031b514523436d6b5e924c9568b0c51de3a13b57f2b` |
| Ordered bundle | `fac892b3941681a26e3eb6fb82a2e1678952958bcbe5ab7610150066ad9d89c1` |
| Expanded test, canonical LF | `214600fc5cee77a5514a86826da14518f8342af57a4daaa0b01a942852b011e3` |
| Identical regenerated WASM | `2bb78c97eb9ac347922b69edd4e1808c83597ffb7094c1b7ea9c1da9e028e817` |
| Identical regenerated manifest | `c342e0e1b1500b8d55d7b86e63cdb8f4ef8031257c789cb2416edbec25f6cc41` |

Next: audit non-entry parameter/context handling before a general private
function encoder can consume the existing source-derived MIR. Borrowed-vector
length, cloning, and multi-value returns require their own native parity gates.
The frozen bundle still self-copies; source-responsive successor production
remains RED and the exact I240 seed remains missing. No bootstrap percentage
is promoted by these encoding prerequisites.
