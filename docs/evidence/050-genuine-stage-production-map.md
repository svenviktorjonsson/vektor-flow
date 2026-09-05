# Genuine compiler-stage production map

Read-only map at bootstrap `2f622dd7c6f70aef0bf080dcbfcdfe3c81afbd66`.
This describes inspected source paths, not a new bootstrap acceptance result.

## First self-copy seam

`tests/bootstrap/stage2-locked-source-graph-fixed-point.test.mjs` constructs a
VKF driver that:

1. reads the locked graph's source bytes;
2. calls `_compile_locked_valid_source_graph`;
3. writes the returned sources unchanged; and
4. calls `io_stage.write_bytes(next_compiler_path, io_stage.read_bytes(self_path))`.

`compiler/self_hosted/compiler.vkf::_compile_locked_valid_source_graph` returns
`(sources:sources, source_count:sources.length())`. It performs no lexing,
parsing, typed lowering, code generation, or compiler artifact production.

The **next-compiler byte write** is the first concrete artifact seam that must
consume source-generated compiler bytes instead of `self_path` bytes. Merely
replacing the graph pass-through with validation would not close that seam.
Nor would rebuilding a compiler with Stage 0 inside this driver satisfy it.

The same next-compiler self-copy occurs in the later owned-x64 fixtures,
including `stage2-owned-x64-code-section-replacement-fixed-point.test.mjs`.
That fixture genuinely calls a VKF producer to make a program artifact, but
still copies its compiler executable for the following iteration. Program
artifact equality and compiler-source self-compilation are different claims.

## Existing components and their actual reach

| Existing path | What it produces | Why it cannot yet replace the compiler self-copy |
| --- | --- | --- |
| `compile_tagged_dependency_tape` | Validated numeric opcode/value tape for a constrained binding chain | Not a parser/lowerer for the compiler's records, functions, strings, errors, imports, and I/O |
| `compile_tagged_module_statement` | Existing typed/Machine-IR module representation for a homogeneous statement tape | The corresponding “full module functions” test feeds `valueN+N` statements, not arbitrary VKF function declarations |
| `_compile_tagged_numeric_literal_function_chain_runner_seed_x64` | Source-derived code and PE placement for the existing three-function numeric fixture | Function matching is constrained to `num` multiplication/literal-call grammar; opaque runtime pieces remain inputs |
| `pe_x64.runner_seed`, `code_section`, and `materialize_code_section` | Source-owned PE fields, relocations, placement, and section replacement | Container construction does not supply missing compiler-source semantics or code generation |
| `stage1-bootstrap-executable-bundle` | Stage-0-compiled executable source units | Executing an otherwise declaration-only unit with empty output does not show that it compiles a successor |

**No existing component is a drop-in producer of the next complete compiler.**
The closest executable-code composition is the existing numeric-function
producer plus `pe_x64` container path. It is useful to retain, but expanding a
fixed grammar matcher or copying its body would not amount to a general
compiler. Do not add another source-pattern frontend to bridge this gap.

Earlier fixtures such as `stage2-minimal-compiler-cli` and
`stage2-function-call-compiler-cli` call `process.run_native` back into the
Stage-0 observation bridge. They are historical differential seams, not an
acceptable restored production path under the current no-fallback contract.
They were inspected, not rerun or modified by this audit.

## Earliest observed source dependency

The fresh runtime-input tokenization probe of actual `lexer.vkf` stops at its
line-29 equality expression. That is an existing native language form missing
from the private numeric tape. Its proposed addition is paused because the
shipped generic manifest exposes helper results; see
`docs/plans/bootstrap-token-helper-boundary.md`.

The escaped-string prerequisite was independently repaired in `2f622dd7`
without new codes or ABI changes. That does not remove the equality blocker,
full token/indentation gaps, broad typed lowering gaps, or the compiler-copy
seam. Uncaught diagnostics are separately pending at
`docs/plans/uncaught-assertion-diagnostic.md`.

## Smallest honest next evidence slice

After the required compatibility decision, advance the existing producer on
actual compiler-source constructs using runtime input and native token/span
parity. Then prove the next parser/typed-IR behavior using a real compiler
function as input, rather than substituting an arithmetic benchmark. Keep
source-semantic production and existing PE/container consumers distinct.

Before claiming a compiler-stage cutover, a new source-production fixture must
show all of the following without weakening existing tests:

- The current compiler consumes the compiler source and its locked dependency
  graph, producing the next compiler artifact from that source.
- The producer does not read/copy its current executable, a precompiled next
  compiler, or a recorded output artifact, and invokes no Stage-0 process.
- A source-semantic mutation changes the emitted compiler's observable
  behavior; unchanged source produces deterministic equivalent artifacts.
- A malformed compiler-source mutation is rejected with the approved exact
  first diagnostic before any output artifact is published.
- The resulting compiler repeats the operation and passes the same required
  language/ecosystem suite. Only then is compiler artifact equality meaningful
  as a bootstrap fixed point.

This is an evidence plan, not a new public API or frozen gate replacement.
No source code, schema, diagnostic, ABI, or test assertion changed in this map.
The missing I240 seed remains separate; no rebuilt seed was substituted.
No ADR-0005 percentage is promoted by this audit.

## Read-only addendum: named-token parser stub

Inspected at bootstrap `dedada4e30cdae5f6e462d5feda00b23f58eb0cb`.
`compiler/self_hosted/parser.vkf::parse_module_from_cursor` (line 1170) peeks
the first token and unconditionally returns
`module_node([], span(first.location, first.location))`.
`parse_token_stream_json` calls this function after decoding the envelope and
calling its shape/EOF helpers. Thus the named-token entrypoint also has no
module-body production; solving private tape tokenization alone cannot fix it.

Adjacent helpers are not a hidden complete parser: `parse_block` returns an
empty block; `parse_call` supplies an empty argument list;
`parse_function_definition` supplies empty parameters and a null return type;
`parse_statement` dispatches only IDENT to `parse_bind`. Capability prose about
`vkf_parser_token_stream_smoke` describes the native smoke path, not proof that
these VKF bodies parse the same inputs. This is source inspection, not an
executed runtime RED or a claim about whether the JSON binding is executable.

After the helper-compatibility decision, the smallest future nonempty-AST RED
is runtime input of the canonical envelope for `answer: 42`, through the
existing named-token entrypoint, compared with the native parser's actual bind
node, identifier, literal, and source locations. First establish that the
entrypoint executes without a substituted decoder; if compilation or decoding
fails, preserve that earlier failure rather than claiming the empty-AST RED.
Then vary the binding/value and prove two statements remain in source order.
Malformed input must retain the approved exact first diagnostic. Passing this
slice would prove only that parser behavior, not full parser or bootstrap
completion. No replacement pattern frontend, schema, diagnostic, or source
change is authorized by this addendum; the A/B decision remains in
`docs/plans/bootstrap-token-helper-boundary.md`.
