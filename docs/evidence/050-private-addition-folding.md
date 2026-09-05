# Private addition folding: exact native parity

Baseline: bootstrap `4ab7d9309378b7eaef01d61e5e09cb93a5b29fdd`.
This packet extends only the new, non-manifest source-to-MIR pipeline.
It does not compile the compiler into a successor or execute emitted MIR.

## Native rule and RED

`compiler/native/vkf_machine_ir_lowering.hpp::fold_constant_numeric_expressions`
(line 18565 at baseline) scans left to right for adjacent constant pushes and
an arithmetic operation, folds the leftmost match, and repeats. `lower` calls
it unconditionally, including `mask-0`. The original builder's `max_stack`
is not recomputed after folding. This packet implements only addition,
the sole arithmetic operation supported by the private expression slice.

The runtime-input test previously required constant-only addition to remain
unsupported. Its new positive case is general `2.5+1+4`, not a compiler-fixture
pattern. The unchanged baseline rejects the first addition at token 14.
Durable reproduction uses only a test-local archived source override:

```powershell
git archive --format=zip --output=build/bootstrap-tests/fold-baseline.zip 4ab7d9309378b7eaef01d61e5e09cb93a5b29fdd compiler/self_hosted/machine_ir.vkf
Expand-Archive -LiteralPath build/bootstrap-tests/fold-baseline.zip -DestinationPath build/bootstrap-tests/fold-baseline
$env:VKF_BOOTSTRAP_MACHINE_SOURCE=(Resolve-Path build/bootstrap-tests/fold-baseline/compiler/self_hosted/machine_ir.vkf).Path
node --test --test-concurrency=1 tests/bootstrap/stage1-private-expression-machine.test.mjs
```

With the normal environment below: **0/1**, exit 1, 4947.3304 ms. Exact
runtime result: `false`, `14`, `[1, 1]`, `false`, `2`; the required valid result
is `true`. Working sources, frozen fixtures, and acceptance gates are untouched
by this reproduction. Normal tests omit `VKF_BOOTSTRAP_MACHINE_SOURCE`.

## Implementation and proof transport

`_bootstrap_fold_additions` reduces the active postfix tail only when it is
`push_f64; push_f64; add_f64`. Repeating that reduction while consuming the
stream preserves native leftmost/repeated order, without reassociation.
The lowerer retains the original pre-fold maximum stack depth. No runtime
operation, parameter load, ownership operation, or other arithmetic is folded.

Differential cases include decimal constants, constant chains, grouped
subtrees within runtime length expressions, and the non-associative pair
`9007199254740992+1+1` versus `9007199254740992+(1+1)`.
The first yields 9007199254740992; the second yields 9007199254740994.
The record test combines a folded constant, a runtime-plus-constant subtree,
and an owned vector return. An unresolved second field after `2+3` now fails
at its own token 19, preserving source order after the earlier field succeeds.

Two transport issues were observed, not mistaken for folding failures:

- VKF vector display prints the exact integer 9007199254740992 as
  `9.00719925474099e+015`, losing digits in textual round-trip.
- `native/VfOverlay/vf/json.cpp:308` serializes doubles at `digits10 + 1`
  (16 digits). Native MIR JSON displays `0.1+0.2` as `0.3`, while the native
  in-memory result and the private result are 0.30000000000000004.

Neither public formatter is changed. The test-only C++ target
`vkf_private_machine_operands` reuses native `machine_ir::lower` on the strict
compiler's actual typed-IR receipt. It emits the normal native function JSON
and separate in-memory operands at `max_digits10` (17 digits). Its normal JSON
must exactly equal the independent strict compiler's function, including all
metadata. The VKF harness parses each exact operand through the established
decimal intrinsic and compares numeric equality before JS reconstructs any
instruction fields. Opcodes, ownership flags, local indices, return shape,
and stack depth remain exact comparisons. No tolerance or JS evaluator exists.
The oracle is not installed with compiler tools and never encodes or executes
the module. All source examples in this test use native-supported literals.

## Regression and public identity

Build the test-only oracle with the configured native build:

```powershell
ninja -C build/native-windows vkf_private_machine_operands
$env:VKF_NATIVE_BIN=(Resolve-Path build/native-windows/bin).Path
$env:VKF_BUNDLE_ARTIFACT_TOOL=Join-Path $env:VKF_NATIVE_BIN vkf_bootstrap_bundle_artifact_smoke.exe
$env:VKF_TEST_WORK_ROOT=(Resolve-Path build/bootstrap-tests).Path
$env:TEMP=$env:VKF_TEST_WORK_ROOT
$env:TMP=$env:VKF_TEST_WORK_ROOT
```

Focused scalar and complete-record tests: **2/2**, 13317.3849 ms.
Full unchanged checkpoint listed in `050-private-record-machine.md`:
**23/23**, exit 0, 62270.552 ms. Full bundle in that run: 11777.8314 ms;
locked graph: 8272.2051 ms. Second unchanged full bundle: **1/1**, exit 0,
10916.8037 ms total (10836.5924 ms in the test). These are execution receipts,
not performance claims. No timeout or acceptance gate was weakened.

The entire pre-existing public machine contract beginning at
`MachineInstruction` compares byte-for-byte to baseline. The canonical I94
manifest refresh changes only the machine source hash and ordered bundle hash.
`node tools/build-browser-compiler.mjs --output build/private-parser-visibility/folding-output`
produces WASM and manifest exactly equal to the unchanged archived baseline
under `build/private-parser-visibility/baseline-output`. No private helper is
present in that manifest. Shipped browser files were not changed or deployed.

| Identity | SHA-256 |
| --- | --- |
| Machine source, canonical LF | `837ceb24465c357243b1ca1af928d1aec6bd18a2d204710af0a38bff579f026e` |
| Bootstrap manifest, canonical LF | `572acad7a8e22209cd651704ebe71cd65e0eb1eb4bf39a33e24b530e9c6d427c` |
| Ordered bundle | `2defd4863defc959fed1987270fed3d3469b22db57ec40c6b7a4e23d38dfd535` |
| Scalar test, canonical LF | `d8a2fb7dc4a36f378f3d813775df15dbff4bf2da6be15fe419fee022e2332e58` |
| C++ oracle source, canonical LF | `32f0131921e18faaf478a9deb478c3bc46cd8dc27d5c3df27f1c6a93c11b295c` |
| Built test-only oracle | `3d9358a59a9d409cbcb0ad212e7ca3955d7533ab7fb4b33be6461636cee5bf5e` |
| Identical regenerated WASM | `2bb78c97eb9ac347922b69edd4e1808c83597ffb7094c1b7ea9c1da9e028e817` |
| Identical regenerated manifest | `c342e0e1b1500b8d55d7b86e63cdb8f4ef8031257c789cb2416edbec25f6cc41` |

The source-responsive successor gate remains RED: the frozen bundle still
copies itself. The exact I240 seed is still missing. Exponent lexer parity,
helper compatibility, diagnostic transport, and runtime `[str]` value transport
remain separate pending boundaries. No bootstrap percentage is promoted.
Next producer prerequisite: audit a private MIR-to-target encoding boundary
against the real native encoder, preserving the existing manifest surface.
