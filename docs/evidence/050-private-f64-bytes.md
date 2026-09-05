# Private f64 byte encoding

Baseline: bootstrap `c5f6adf42bf043a27f1c6b16e40f744b8994bad3`.
This is a private encoding primitive, not a target encoder, executable writer,
or proof that compiler source produces a successor.

## Existing native boundary

`MachineX64Emitter::emit_number`, in `compiler/native/vkf_x64_artifact.cpp:2764`,
copies the complete double bit pattern with `memcpy` before emitting a
little-endian immediate. Decimal text is not the encoding contract.
`compiler/native/vkf_machine_ir.hpp:22` reserves the distinct NaN payload
`0x7ff8000000000001` for null. No general NaN canonicalization policy was found.
This packet does not invent one or add a bit-cast intrinsic.

`_bootstrap_f64_bytes` returns exact little-endian bytes for finite numbers,
signed zero, and infinities. NaN, including null, returns private
`valid:false, bytes:[]`; it is never silently changed to another payload.
This private result introduces no public diagnostic or language rule.

The implementation normalizes by exact powers of two, separates the exponent
from the 52-bit significand, and extracts byte-sized integer components.
Subnormals retain exponent zero. The zero sign is observed through the
existing IEEE division behavior. Infinity is detected before normalization,
so it cannot enter a non-terminating scaling loop.

## Incremental RED and GREEN

The first harness shape used a top-level conditional unsupported by the
existing native driver. Moving the harness into an ordinary function preserved
the intended runtime-input check; no compiler behavior was changed to make
that harness work. The genuine missing-entrypoint RED then failed compilation
with `unknown machine IR aggregate projection encoded.valid in 1[]`:
**0/1**, 1000.7136 ms. After the first finite implementation: **1/1**,
1081.3131 ms.

Extending through positive finite extrema/subnormals reached the next actual
unsupported negative input: private `false, []`, **0/1**, 1628.3517 ms.
Signed finite support passed **1/1**, 1582.2532 ms.

The initial signed-zero comparison instead exposed an input-generation gap:
native `NegateF64` uses `+0 - value` at `vkf_x64_artifact.cpp:11848`, so runtime
unary negation of positive zero produces positive zero. This observation is
not counted as an encoder defect or a changed language decision. The test
generates negative zero through existing multiplication by -1. Signed-zero
byte parity then passed **1/1**, 2076.5083 ms. Native unary negation is unchanged.

Runtime overflow produced the next genuine infinity RED: `1 * 2^1024`,
private `false, []`, **0/1**, 2218.6707 ms. Infinity support passed **1/1**,
2038.291 ms. Final focused coverage passed **1/1**, 5293.2396 ms.

## Exact oracle and coverage

The VKF harness reads its significand, power-of-two scale, and sign at runtime.
It executes only numeric construction and the compiler's private encoder.
The test-only `vkf_private_f64_bytes` tool independently constructs the native
double with `strtod`/`ldexp` and applies the native emitter's `memcpy` operation.
Its byte array must match exactly; there is no floating-point tolerance,
decimal output round-trip, JavaScript evaluation of VKF, or recorded byte result.

Coverage includes ordinary fractions, the largest exact significand, the
largest finite value, the normal/subnormal boundary, the smallest subnormals,
every fraction-bit position, both signs, positive and negative zero, and both
infinities. Separate runtime cases assert rejection of arithmetic NaN and the
actual VKF null value. They do not claim arbitrary NaN-payload transport.

```powershell
ninja -C build/native-windows vkf_private_f64_bytes
$env:VKF_NATIVE_BIN=(Resolve-Path build/native-windows/bin).Path
$env:VKF_BUNDLE_ARTIFACT_TOOL=Join-Path $env:VKF_NATIVE_BIN vkf_bootstrap_bundle_artifact_smoke.exe
$env:VKF_TEST_WORK_ROOT=(Resolve-Path build/bootstrap-tests).Path
$env:TEMP=$env:VKF_TEST_WORK_ROOT
$env:TMP=$env:VKF_TEST_WORK_ROOT
node --test tests/bootstrap/stage1-private-f64-bytes.test.mjs
```

The test-only CMake target is excluded from installed compiler tools.
All temporary inputs, oracles, and artifacts stay under this checkout's build.

## Regression and visibility

Full checkpoint from `050-private-record-machine.md`, adding the new byte test:
**24/24**, exit 0, 77459.8267 ms. Its unchanged full bundle passed in
13641.6526 ms; locked graph materialization passed in 8776.8024 ms.
These timings are receipts, not performance claims. Timeouts and acceptance
gates were not weakened.
A second unchanged full-bundle run passed **1/1**, exit 0, 11614.2475 ms
total (11528.7769 ms in the test).

Every pre-existing `machine_ir.vkf` helper body is byte-identical to baseline.
The I94 lock refresh changes only this source digest and ordered bundle digest.
`node tools/build-browser-compiler.mjs --output build/private-parser-visibility/f64-bytes-output`
regenerates public WASM and manifest exactly equal to the unchanged archive's
`build/private-parser-visibility/baseline-output`. No private helper appears in
the manifest; shipped browser artifacts were not changed or deployed.

| Identity | SHA-256 |
| --- | --- |
| Machine source, canonical LF | `4d888af4a13e5a649f3b6bca3523a9017757863b618fe9c4f44030b855314ff6` |
| Bootstrap manifest, canonical LF | `39676461a0af4923434c60de86a094fd0bce42e0b1af2c628b1d99108350130b` |
| Ordered bundle | `6a094571945a12b57b2f2c611f332fe07fd599f9f81b9183483cfb91e4f8f5fc` |
| Focused test, canonical LF | `2a05f5300a2603793d0011590d30078cd4f9590f21849ebc8bf86c4249a8711f` |
| C++ oracle source, canonical LF | `9ef53cb114dad606537ed1c847db6d739ec3155aaa94d64dbe60406f33bf48d7` |
| Built test-only oracle | `cea7aa9334373eba26c518f920751228bc44435078467815501d1dbd6aaddb98` |
| Identical regenerated WASM | `2bb78c97eb9ac347922b69edd4e1808c83597ffb7094c1b7ea9c1da9e028e817` |
| Identical regenerated manifest | `c342e0e1b1500b8d55d7b86e63cdb8f4ef8031257c789cb2416edbec25f6cc41` |

Next: use the private byte representation toward the native frame/prologue
and immediate-encoding boundary, with exact native byte comparisons.
The frozen bundle still copies itself. Source-responsive successor production
remains RED; the exact I240 seed remains missing. No bootstrap percentage
is promoted, and no syntax, public API, ABI, or diagnostic changes are made.
