# Private source-derived vector-length function bytes

Baseline: bootstrap `99a266b40e730bb7fcb9aa8a6c8194818c3ee52c`.
The existing private source/parser/type/MIR pipeline now feeds a narrow
non-entry x64 encoder. Whole-function bytes match the native emitter for
borrowed-vector length and scalar return. Neither these bytes nor the native
comparison functions are executed. This is not an executable-container,
runtime-adapter, full-compiler, or source-responsive successor gate.

## Native contract and private scope

The shared frame/prologue/epilogue was extracted while the existing entry and
prefix parity test was GREEN. That unchanged test passed **1/1**, 2131.7729 ms
total. Prior private entry bytes remain exact; their source bodies are
intentionally refactored, not claimed byte-identical.

`_bootstrap_x64_borrowed_scalar_function` accepts already-validated borrowed
vector parameters, private opcode/operand arrays, and the declared maximum
stack. It follows native `MachineX64Emitter::emit_function`:

- Save the non-entry result context R11, not the entry runtime context R12.
- Load source-ordered argument cells from R10 into parameter/local slots.
- Encode load-local, borrowed count, numeric literal push, numeric divide,
  and final scalar return, using the shared frame and exact f64 bytes.
- Restore R11, store the scalar result through it, and restore saved registers.

Relevant unchanged native definitions in `vkf_x64_artifact.cpp`: `make_frame`
2590, prologue 2660, epilogue 2689, result-context save 2728, R10 argument load
2738, `PushF64` 11585, borrowed `CountF64List` 12589, arithmetic 13097, and
`ReturnF64` 13383. The `[str]` case preserves native count/push-2/divide because
each string occupies two vector cells. It does not prove string-vector value
transport or runtime execution.

This encoder has no owned locals, extra locals, scratch/error slots, parameter
mask, clone, calls, or multi-value returns. It is not a general MachineFunction
adapter. At least one count is required: native `mask-0` leaves integer and
register-cache tiers enabled, but both naturally reject `CountF64List`.
No optimizer tier is disabled to manufacture parity. Invalid opcode shapes,
types, bounds, metadata operands, stack/return order, and null-as-number inputs
produce private `valid:false, bytes:[]`, never partial code or a new public
diagnostic. Windows x64 alone is verified here.

## Independent oracle and RED to GREEN

The test-only native oracle adds `--function typed-ir.json name`. It invokes
the existing native MIR lowerer and emitter with unchanged mask-0 defaults.
A separately emitted dummy entry must match the entire leading entry of the
combined entry-plus-target emission. Removing that independently known entry
length gives the **whole** target function, without symbol/byte-pattern lookup.
The returned native function JSON must also equal the strict compiler's MIR.
The test-only translation unit is not installed; no production hook is added.

The first real-source case, `measure(items:[num])` returning the one-field
record `(count:items.length(),)`, was compiled natively before implementation
with `artifact_fallback:false` and `ran:false`. Its MIR is load-local-0,
borrowed count, scalar return; max stack 1 and no owners/errors/mask.
The missing private producer then gave **0/1**, 8659.6951 ms total, with
`<driver-smoke>:1:1: direct x64 backend unsupported: machine IR supports direct calls only`.
The first load/count/return implementation plus unchanged entry test passed
**2/2**, 9323.177 ms total.

Next, renamed/reordered vector parameters passed before the `[str]` case gave
the next genuine RED: parsed `true`, encoded `false`, bytes `[]`;
**0/1**, 9238.1366 ms total. Implementing general numeric push and native
divide encoding gave **1/1**, 9313.7489 ms. The final focused test passed
**1/1**, 10776.0103 ms total: numeric/bit/int/string vector cases, renamed and
reordered parameters, plus 27 malformed private inputs retaining empty bytes.
These are test cases, not language-coverage percentages.

## Reproduction and regression

Use the native-bin/work-root environment from `050-private-x64-entry-prefix.md`.
The strict compiler is only used with `-b --optimizer-policy mask-0` for
comparison artifacts. Test drivers execute VKF byte construction; they never
execute the emitted byte arrays or native comparison executables.

```powershell
ninja -C build/native-windows vkf_private_x64_prefix
node --test tests/bootstrap/stage1-private-x64-vector-length.test.mjs
node --test --test-concurrency=1 tests/bootstrap/stage1-private-x64-vector-length.test.mjs tests/bootstrap/stage1-private-x64-prefix.test.mjs tests/bootstrap/stage1-private-f64-bytes.test.mjs tests/bootstrap/stage1-private-record-machine.test.mjs tests/bootstrap/stage1-private-expression-machine.test.mjs tests/bootstrap/stage1-private-expression-types.test.mjs tests/bootstrap/stage1-private-expression-tree.test.mjs tests/bootstrap/stage1-private-record-function-shape.test.mjs tests/bootstrap/stage1-comment-token-producer.test.mjs tests/bootstrap/stage1-direct-decimal-parse.test.mjs tests/bootstrap/stage1-bootstrap-source-graph.test.mjs tests/bootstrap/stage1-ast-to-ir-logical-chain.test.mjs tests/bootstrap/stage1-bootstrap-executable-bundle-unit.test.mjs tests/bootstrap/stage1-bootstrap-executable-bundle.test.mjs tests/bootstrap/stage2-locked-source-graph-fixed-point.test.mjs
node --test tests/bootstrap/stage1-bootstrap-executable-bundle.test.mjs
node tools/build-browser-compiler.mjs --output build/private-parser-visibility/x64-vector-length-output
```

First full checkpoint: **26/26**, exit 0, 78272.6818 ms. After the usage reset,
the preserved diff was re-read and the unchanged full checkpoint rerun:
**26/26**, exit 0, 82060.6712 ms. Full bundle in the rerun: 11665.6738 ms;
locked graph: 8807.157 ms. A further unchanged full-bundle run passed **1/1**,
exit 0, 11935.1224 ms total (11835.3673 ms test). Timings are receipts, not
performance claims. No tolerance, timeout, or acceptance gate was weakened.

## Lock and public identity

The canonical I94 refresh changes only machine-source and ordered-bundle
hashes. The machine file from `# Private scalar expression fragment` onward
compares byte-for-byte to baseline, preserving earlier parser/MIR and public
helper bodies. Regenerated public WASM and manifest compare exactly to the
untouched archived `build/private-parser-visibility/baseline-output`; the
manifest has no private helper exports. Shipped browser files are untouched
and were not deployed by this packet.

| Identity | SHA-256 |
| --- | --- |
| Machine source, canonical LF | `d21b3262770ace509bdacfcf0d4018da3fc8822e05ecfa6792d278a06138edbb` |
| Bootstrap manifest, canonical LF | `442cdee1f79ec34d2df5cefed4e8fa7b4d5b5d1f5ec8560959ed7d5e4c342f6d` |
| Ordered bundle | `7b7463a1e63fd1169320a7e8b79ba7b02f49e5645f73c847fabac467895d5e80` |
| Focused test, canonical LF | `d8a65f02483519ed990ea9af7858615c3ccf314bfcd11673f74561b076bc946f` |
| Native oracle source, canonical LF | `480c7697f51a4914cba825c7e6ddf4f8d2534bef3624bb9d962712d47071ed0e` |
| Built test-only oracle | `4e5b7d7c870bccb3a7c768f4a306fa403d83a2bed265aff72ba9dad25ada56e1` |
| Identical regenerated WASM | `2bb78c97eb9ac347922b69edd4e1808c83597ffb7094c1b7ea9c1da9e028e817` |
| Identical regenerated manifest | `c342e0e1b1500b8d55d7b86e63cdb8f4ef8031257c789cb2416edbec25f6cc41` |

Next bounded RED: general private numeric addition over the existing
source-derived scalar MIR, including `length()+1` and renamed variants, with
exact whole-function native bytes and unchanged native tier selection. Cloning,
multi-value return, container/runtime composition, and compiler-successor
production remain separate. The frozen bundle still self-copies; the exact
I240 seed remains missing and source-responsive successor production remains
RED. No bootstrap percentage is promoted by this prerequisite.
