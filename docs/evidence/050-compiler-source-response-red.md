# Compiler-source semantic response: RED

Base: bootstrap `f882f577d74f510f24b14d2ff76e336908fb2176`.
Windows x64, Node 22.14.0. This diagnostic harness is not a replacement frozen
gate, and its intentional failure is not counted as a passing test.

## Exact experiment

```powershell
$env:VKF_NATIVE_BIN=(Resolve-Path build/native-windows/bin).Path
node tools/audit-bootstrap-source-response.mjs
```

The run inherited `SetErrorMode(0x8003)` to suppress crash dialogs. Compile and
execution limits remain the source fixture's 180000 ms and 20000 ms.

The harness reads the exact driver-generation expression from
`stage2-locked-source-graph-fixed-point.test.mjs`, including its self-copy
write, without editing that fixture. It canonicalizes and checks each locked
source SHA, then creates two isolated input copies under
`build/bootstrap-source-response/run-l79xJA`. Only the second copy changes
`compiler.vkf::_compile_locked_valid_source_graph` from
`(sources:sources, source_count:sources.length())` to
`(sources:sources, source_count:sources.length() + 1)`.

The canonical checkout and manifest remain untouched. The altered input is an
explicit mutation experiment, not a claim that it still matches the original
source lock. The test verifies the changed source survives materialization.
The graph count is used only as a concrete observable semantic probe, never as
a completion measure.

## Observed behavior

| Executable under test | Reported graph count | Result |
| --- | --- | --- |
| Original stage, original source | `11` | Baseline control |
| Original stage, altered source | `11` | Produces unchanged successor |
| Baseline successor | `11` | Baseline behavior preserved |
| Altered-source successor | `11` | Ignores compiler-source semantic change |
| Native compilation of altered source | `12` | Proves mutation is valid and observable |

All five executions exit 0 with empty stdout/stderr. The audit then exits 1:
`successor ignored semantic compiler-source mutation: current driver copies its executable`,
with actual `11` versus expected `12`. This is the observed RED; no GREEN is
claimed. Native compilation is a test-only control, never a process invoked by
the stage executable or a proposed production fallback.

SHA-256 identities:

| Item | SHA-256 |
| --- | --- |
| Frozen fixture, canonical LF | `33f77fa0fbcdaae63ffbaaf2bd9623cff1635aa09e7215eb66a82dcfc3f2f0c3` |
| Reused generated driver | `9ec43d8d99b5bbba5473524f885c4eb76737c20d85c4e164d574d3a896201604` |
| Native compiler | `1d2d8e9bd9f2e8b0f4320f653ed862ad77d2a689144b3e812c66d6e45130c41b` |
| Original locked bundle | `af555c9aa8268be3084e7f4e37c636749b22be80149fe494bd3ac2a9fe66c873` |
| Original compiler source | `8a8061c5d0b7aa59122d1b5e7f3f09c54cd9290603486044d8138b5c11b418b1` |
| Altered compiler source | `e4832a3a69a7311214d9abcf1debcf1f27ed2ffc242c1ef38e50ad8ec8886df7` |
| Original stage and every original-stage-produced successor | `09851a43222dabfa6d6588cb84294add8d3450f5ce968c2006daca039aa1c5a0` |
| Native altered-source control | `e4aa8fe75491f973845a1dc941049eff5e274696b791332dc77654e7129f30a7` |

The generated `receipt.json` records all source identities, input/output paths,
and execution outcomes before the intentional assertion failure. Artifacts
remain inside the checkout's build directory and are not staged.

## Smallest actual implementation seam

The driver still writes the next compiler using
`io_stage.write_bytes(next_compiler_path, io_stage.read_bytes(self_path))`.
That byte source must eventually become a genuine compiler-source artifact
producer. `_compile_locked_valid_source_graph` only returns source strings and
their count; changing that count or special-casing this mutation would not
repair the self-compilation gap. There is no inspected general producer ready
to drop into this write. The existing numeric fixture emitters cannot compile
the full compiler graph, and the named-token parser still returns an empty
module (see `050-genuine-stage-production-map.md`).

No production implementation was attempted. Any observable helper or schema
change remains under the pending compatibility decision. No new diagnostic,
pattern frontend, executable patch, seed substitution, or acceptance weakening
was introduced. Missing I240 evidence remains separate. No bootstrap percentage
is promoted by this RED.

The unchanged normal regression suite subsequently passed 15/15 (exit 0,
31500.9971 ms total): comment-token producer, direct decimal parse, source
graph locks, AST-to-IR logical chain, bundle unit, full executable bundle, and
locked-source graph fixed point. Full-bundle execution was 10681.0754 ms.
All original assertions/deadlines remained unchanged. The intentional RED
tool is outside the normal test suite; these GREEN results do not erase its
source-response failure or prove genuine self-compilation.

## Required general producer slice

To make this exact mutation affect the successor without recognizing its text
as a special case, the existing compiler pipeline needs to parse a `[str]`
parameter and record result, resolve `sources.length()` against that parameter,
lower ordinary numeric `+ 1`, and emit/link the resulting function with the
compiler's reachable functions and runtime. Returning altered source text or
patching one immediate in a copied executable would not satisfy that boundary.

Inspected reusable pieces and their limits:

- `typed_ir.vkf::typed_function`, `typed_record`, and `typed_return` construct
  existing representations; they do not implement a general AST/type traversal.
- `machine_ir.vkf::mir_lower_numeric_parameter_multiply_function_module`
  validates a numeric multiplication fixture and assembles its CPU-count entry;
  it does not lower this list-length/record-return function.
- `compiler.vkf::_compile_tagged_numeric_literal_function_tape` extracts fixed
  token offsets and emits `[1, 1, 5, 3]`; extending that matcher for this one
  mutation would introduce the prohibited fixture-specific frontend.
- `_compile_tagged_numeric_literal_function_chain_runner_seed_x64` takes
  opaque runtime, prologue, multiplication, epilogue, and bridge bytes. Existing
  PE placement is reusable later but does not supply general compiler codegen.

Search of the shipped manifest found neither
`_compile_locked_valid_source_graph` nor the named-token parser entrypoints.
That does not make the prerequisite lexer changes invisible: the existing tape
helpers are manifest-callable, as established in the helper-compatibility
packet. No independently complete general step was found that can make this
RED GREEN while keeping that pending boundary fixed. The decision remains
whether those undocumented helpers may evolve (A) or require preserved/versioned
behavior (B); it is not permission to change VKF language semantics, public
diagnostics, or bypass the missing general pipeline.
