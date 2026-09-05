# Browser tuple representation audit — 2026-09-05

Read-only source audit on dirty `main`; no compiler, runtime, manifest or ABI
change was made. This is a design finding, not executable tuple coverage.

## Native semantic facts

- `vkf_value_layout.hpp::layout_from_type` lowers `tuple<...>` to indexed
  heterogeneous component layouts. Fixed vectors share the physical indexed
  layout, but this does not erase their language-level distinction.
- `display_shape_from_type` and `display_shape_from_expression` preserve
  `DisplayKind::Tuple` versus `DisplayKind::Vector`, including nested children.
- Native exact aggregate equality also compares original type keys before
  comparing leaves (`vkf_machine_ir_lowering.hpp`, exact aggregate equality).
  Equal physical width is insufficient. Owned string leaves have content
  comparison; unsupported resource equality fails explicitly.
- Native fixed projections resolve exact numeric selectors and flattened
  offsets. Updates validate nonnegative constant indices and exact selected
  layouts, release replaced resources, and establish independent value
  ownership before stores. Reusing mutable object/array pointers alone would
  not prove these ownership rules.
- `tests/vkf/tuples.vkf` covers indexing, updates, resource ownership, parameter
  and return shape, and shape-specific matching. `function_tuple_types.vkf`
  additionally preserves singleton and nested tuple domains/codomains.
- Canonical context says ordinary function lifting descends through vectors,
  not tuples or records. A common storage format cannot grant vector semantics
  to a tuple.

## Current browser ABI facts

`vkf_wasm_value_layout.hpp` explicitly documents a browser transport ABI with
16-byte slots: tag at +0, length at +4, payload at +8, and **+12 reserved and
zero**. Valid tags are exactly null, boolean, number, UTF-8 string, array and
record (0 through 5). No existing tuple tag or extension bit is reserved.

`vkf_wasm_artifact_manifest.hpp` emits `vektor-flow.symbolic-kernel`, version 1.
Per-function metadata contains index, parameter count and coarse bytecode
result type, not a recursive tuple/record/vector descriptor. The top-level
program output is itself an array of dynamically tagged values, so the manifest
cannot reconstruct each nested output's identity.

`web/vf-ui/vf-symbolic-kernel-runtime.mjs` writes JS arrays as array-tagged values
and objects as records. Decoding reverses that mapping and rejects unknown
tags. `SymbolicKernelHandle` retains an exact slot and can pass it back without
decoding, but existing public `invokeValue` still promises decoded values.

`vkf_stdout_format.hpp` formats arrays with brackets and records with named
fields in parentheses. It has no positional tuple case. Existing VM aggregate
equality ultimately compares pointers after scalar/string cases; tuple value
equality is not already provided by that path.

## Finding

The same physical pointer-array payload could be reused **with an explicit
tuple discriminator**, but the current public ABI has no such discriminator.
Using the array tag would collapse tuple/vector identity at decoding and
printing. Using record keys as an undocumented marker would collide with the
general record transport domain. Using slot +12 violates its zero contract.
Adding recursive side metadata would also extend the public transport/schema.

Therefore complete unambiguous tuple transport needs an explicitly versioned
ABI/adapter extension; no safe drop-in reinterpretation of the existing value
format was found. A compiler-private representation confined behind opaque
handles can defer decoded tuple APIs, but cannot silently redefine the existing
public decoded-value contract or make all integrations tuple-capable.

The smallest observable authority question is in
`docs/plans/browser-tuple-transport-decision.md`. It asks about what a webpage
receives, not numeric tags, byte offsets or instruction design. No GitHub issue
was published and no approval is inferred from this audit.

## Verification required after approval

One native/WASM tracer at a time: numeric tuple creation/indexing; singleton
and nested tuples; exact tuple-versus-vector output and type/equality behavior;
independent update/copy ownership including strings/lists; function domains and
returns; named-rest capture; matching/lifting exclusions; then original tuple
and call suites unchanged. Transport checks must reject unknown versions/tags,
truncation, invalid pointers, malformed nesting and cross-instance handles.
Repeat emission and replay remain deterministic. No tuple-as-array shortcut or
weakened acceptance gate is authorized.
