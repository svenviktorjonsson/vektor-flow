# Private source-to-record-function MIR

Base: bootstrap `9a32631bbc86f579ad9c2be7e4bec80aab0bfc70`.
The private `_bootstrap_record_function_machine` producer composes the existing
private declaration parser, expression parser, type facts, and scalar MIR
fragments. It now constructs complete instruction streams for the supported
record-return function shape, preserving field/source order and ownership.

This is **source-to-MIR structural proof only**. It does not emit/link an
executable, compile a module/dependency graph, run emitted MIR, or produce a
successor compiler. Existing stage production still self-copies.

## Native boundary and RED

Before implementation, native `mask-0` MIR established:

- A vector returned as a record field uses `load_local; clone_f64_list`.
- A borrowed vector used for length uses `count_f64_list owns_input:false`;
  string-vector length also divides by its two-cell element width.
- A one-cell record uses `return_f64`, not `return_values 1`.
- Multi-cell records use `return_values` with their actual result width.
- These record results retain `result_is_numeric_scalar:false` and
  `result_is_dynamic_f64_list:false`, including one-field records.

The first runtime-input producer test failed at the missing private entrypoint:
0/1, 7388.2161 ms, with
`direct x64 backend unsupported: machine IR supports direct calls only`.
After general composition and the owned-result helper, the actual compiler
function matched the complete native MachineFunction: 1/1, 7473.3113 ms.

The owned-result helper preserves the earlier scalar entry unchanged. Scalar
results reuse its implementation. Vector results must be validated parameter
loads, optionally grouped, and acquire a native `clone_f64_list` before return.
No borrowed value is silently substituted for an owned result.

## Exact differential coverage

`stage1-private-record-machine.test.mjs` reads the actual
`_compile_locked_valid_source_graph` function from compiler source and also
tests its `length()+1` mutation. Other fixtures rename/reorder parameters and
fields, return several vectors, group a returned vector, use one-field scalar
and vector records, and combine integer/decimal constants with runtime length.

The oracle compiles the same record function through native `mask-0`, makes
it reachable using a bound result, and asserts `artifact_fallback:false` and
`ran:false`. Oracle artifacts and emitted MIR are never executed. The runtime
harness executes only the VKF compiler stages producing the instruction data.

The comparison covers the **entire native MachineFunction**: instructions,
parameter names/order, locals and local classes, ownership-local vectors,
parameter masks, numeric-parameter flags, result flags, error flag, and maximum
stack depth. Test-only serialization does not evaluate the source or its MIR.

Negative cases retain exact private error indices: an earlier unresolved
field before a later unresolved field; a later unresolved field after a valid
owned result; unsupported constant-only folding before a later name error;
wrong length arity; a binding instead of a record; and duplicate parameters
before an unresolved body name. No public diagnostics are introduced.

The scalar entry still rejects direct vector returns, as its existing test
requires. The new explicitly owned entry is the only path adding the clone.
Constant-only folding remains unsupported, not an unfused alternate stream.
This packet does not broaden the earlier source/token/type-validation scope.

## Regression and public bytes

Full checkpoint: **23/23**, exit 0, 58568.7063 ms. Whole-function differential
test: 8042.8727 ms; full executable bundle: 11202.8387 ms; locked graph
materialization: 8241.7478 ms. Timings are receipts, not performance claims.
All existing assertions, timeouts, and acceptance gates remain unchanged.
A second unchanged full-bundle run passed **1/1**, 11393.7926 ms total
(11305.4092 ms in the test).

Run the command/environment in `050-private-expression-types.md`, adding
`stage1-private-expression-machine.test.mjs` and
`stage1-private-record-machine.test.mjs` under `tests/bootstrap`.

Every pre-existing helper body is byte-stable. Only new private helpers are
added in `compiler.vkf` and `machine_ir.vkf`. The I94 canonical lock refresh
changes their two source hashes and the ordered bundle hash.

```powershell
node tools/build-browser-compiler.mjs --output build/private-parser-visibility/record-machine-output
```

Both regenerated public files compare exactly to the untouched archive's
`build/private-parser-visibility/baseline-output`, using the tools and recipe
in `050-private-record-function-shape.md`. No private helper is present in the
generated manifest. Shipped browser artifacts were not changed or deployed.

| Identity | SHA-256 |
| --- | --- |
| Machine IR source, canonical LF | `b0a1458b8d74e78559fbfedcc3a8fbc9bb7042fe449aadbf3ba70811d981ce3d` |
| Compiler source, canonical LF | `1b247b384ecc54a0ccd710a1867f26855cf87c67e24920d6291532c9a50ca765` |
| Bootstrap manifest, canonical LF | `e585e717fd78d976968b343bc78fa0f9a5ffb7aa11426625b07b660c71a90936` |
| Focused test, canonical LF | `ae4cc09621520afb675cff06a07b8c98128c56d65c052aa122166f00ba458b03` |
| Ordered bundle | `2d64eb319d2578862e828765b047e2e2831af8548e2e6856adce658ffcfc16fc` |
| Identical regenerated WASM | `2bb78c97eb9ac347922b69edd4e1808c83597ffb7094c1b7ea9c1da9e028e817` |
| Identical regenerated manifest | `c342e0e1b1500b8d55d7b86e63cdb8f4ef8031257c789cb2416edbec25f6cc41` |

The source-response executable audit remains RED. The exact I240 seed is still
missing; no substitute or percentage promotion is made. Existing exponent,
helper-compatibility, diagnostic-transport, and `[str]` value/display gaps
remain separate. Complete structural MIR for a supported function does not
establish runtime string-vector behavior or self-compilation of the compiler.
