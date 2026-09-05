# Private x64 entry prefix

Baseline: bootstrap `fc2442cd9a0e86014542c470131f71c5617a3379`.
This packet emits a **partial, non-executable prefix**, ending after the first
`push_f64` stores its value in the frame. It does not emit a return, complete
function, PE image, runtime adapter, or source-responsive compiler successor.

## Exact native boundary

The oracle is the existing `MachineX64Emitter::emit` in
`compiler/native/vkf_x64_artifact.cpp`, not a copy of its encoding logic.
The test-only translation unit includes that implementation with its existing
library macro and calls the normal public `emit` method. It adds no production
hook or access override and never executes emitted code.

Two modules define the boundary independently of the private implementation:

- `push_f64; return_f64` produces the complete native entry function.
- `push_f64; drop` balances the stack and deliberately omits the return.
  Native `drop` emits no bytes here, so this output ends exactly after the
  initial numeric store.

The test first proves the second output is a proper prefix of the first,
then compares the **entire** private prefix to that second output. A shorter
matching prefix cannot pass. No symbol/byte-pattern search selects an offset.

Relevant native definitions at baseline: `make_frame` at line 2590,
`prologue` at 2660, `save_runtime_context` at 2713, `emit_number` at 2764,
`emit_stack_allocation` at 313, and the `PushF64` branch at 11585.

## Scope and implementation

`_bootstrap_x64_entry_prefix` accepts local count, declared maximum stack,
literal value, and the explicit Windows-versus-SysV target flag. Its narrow
frame has no parameters, owned locals, parameter mask, scratch slots, or error
slots. This is not a general MachineFunction adapter or validator.

Frame slots preserve native local/temporary ordering, runtime context, saved
registers, alignment, and caller shadow space. Single-page allocation and the
native page-probing loop are encoded exactly, including the backward rel32
displacement and a possible trailing remainder allocation. The private word
helper accepts already range-checked immediate/displacement inputs.
The existing `_bootstrap_f64_bytes` supplies the literal's exact IEEE bytes;
NaN rejection remains unchanged.

Negative or fractional local counts, nonpositive or fractional maximum stack,
and frame sizes beyond the signed-32-bit allocation/displacement boundary
return private `valid:false, bytes:[]` before any partial bytes are published.
No public diagnostic is invented. Windows x64 is the verified target for this
receipt. The SysV branch follows the existing native target contract but was
not executed here; no Linux/macOS acceptance gate is promoted.

## RED to GREEN

Runtime-input missing-entrypoint RED: **0/1**, 1206.3203 ms, with exact native
message `direct x64 backend unsupported: machine IR supports direct calls only`.
The first complete prefix comparison passed **1/1**, 1123.0647 ms.

Varied smaller frames and the 4096-byte boundary passed before the next RED:
local count 497 and maximum stack 1 require a 4112-byte Windows frame, which
the initial single-page slice rejected with `false, []`: **0/1**,
1352.7448 ms. During implementation, assigning a fixed vector directly into
the dynamic byte field produced the existing native update-layout diagnostic.
Appending to the declared dynamic byte vector preserved its layout; no
compiler rule changed. Page-probed parity then passed **1/1**, 1567.9942 ms.

Final focused cases passed **1/1**, 1859.9852 ms: varied local counts, maximum
stack values and literals; exact one-page and two-page allocations; allocations
with remainders; and invalid-frame rejection. Neither oracle output nor the
private prefix was executed. Byte construction does not execute emitted MIR.

```powershell
ninja -C build/native-windows vkf_private_x64_prefix
$env:VKF_NATIVE_BIN=(Resolve-Path build/native-windows/bin).Path
$env:VKF_BUNDLE_ARTIFACT_TOOL=Join-Path $env:VKF_NATIVE_BIN vkf_bootstrap_bundle_artifact_smoke.exe
$env:VKF_TEST_WORK_ROOT=(Resolve-Path build/bootstrap-tests).Path
$env:TEMP=$env:VKF_TEST_WORK_ROOT
$env:TMP=$env:VKF_TEST_WORK_ROOT
node --test tests/bootstrap/stage1-private-x64-prefix.test.mjs
```

## Regression and public bytes

Full checkpoint from `050-private-record-machine.md`, adding the f64-byte and
prefix tests: **25/25**, exit 0, 70566.8306 ms. Full bundle within that run:
12963.2027 ms; locked graph: 8060.2729 ms. No tolerance, timeout, or acceptance
gate changed. Timings are receipts, not performance claims.
A second unchanged full-bundle run passed **1/1**, exit 0, 11450.0356 ms
total (11354.7902 ms in the test).

Every pre-existing machine helper body compares byte-for-byte to baseline.
The I94 lock refresh changes only the machine source and ordered bundle hashes.
`node tools/build-browser-compiler.mjs --output build/private-parser-visibility/x64-prefix-output`
produces public files exactly equal to the unchanged archived baseline at
`build/private-parser-visibility/baseline-output`. No private helper is exported.
The test-only native target is not installed. Shipped browser files are untouched.

| Identity | SHA-256 |
| --- | --- |
| Machine source, canonical LF | `4cd304aec77e6caa4d507b86b19d7f849c121b7764c34bc2662a6a0fa41cd0dc` |
| Bootstrap manifest, canonical LF | `a256b0921b651183b3ef891cc6a8ddc868b4de04910140d7864f8e8fa369cfe4` |
| Ordered bundle | `572402b711ff3341b35b212a392c521fb9b9a3d45dd8412bd90b5cff912bac16` |
| Focused test, canonical LF | `4f1add8b5b1ff48f780a3ca1fde42872b87560fb7f1ba0ff6cf13c939d4fba1b` |
| Native oracle source, canonical LF | `7be44e8820130664d95b6d9554f0bfe6fd394afa2c7c8f0b5f2af6fb40f85384` |
| Built test-only oracle | `476c1c4849913cadf30b6d1b89b7e54ef6667e717863dbc46cf1fd96f08e183f` |
| Identical regenerated WASM | `2bb78c97eb9ac347922b69edd4e1808c83597ffb7094c1b7ea9c1da9e028e817` |
| Identical regenerated manifest | `c342e0e1b1500b8d55d7b86e63cdb8f4ef8031257c789cb2416edbec25f6cc41` |

Next bounded encoding prerequisite: restore context/registers and emit the
existing scalar return/epilogue, then compare the complete non-executed entry
bytes to native. Non-entry parameter ownership and broader opcodes remain
separate. Frozen bundle self-copy, the missing exact I240 seed, and the
source-responsive successor RED remain unchanged. No percentage is promoted.
