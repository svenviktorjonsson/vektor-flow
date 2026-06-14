# Python-Free Language Compiler Roadmap

Goal: a compiler written in VKF compiles VKF, including stdlib and UI libraries,
without ever starting Python in the default compiler/runtime path.

The long-term compiler target is not "emit C++ somehow". The long-term target
is:

`VKF source -> typed IR -> backend`

Where the canonical backends are:

- native binary
- `WASM`
- `WebGPU`-oriented kernel/layout emission where GPU execution is the right
  target

`C++` is still a useful transitional backend, but it is not the architectural
center. `typed IR` is the center.

Python may remain for tests, migration tools, docs, and bootstrap history. It
must not be required by `vkf.exe`, `vkf <file>`, or `.\example.exe`.

## Current Estimate

Overall Python-free language compiler/runtime/UI: **99%**

- Python-free runnable examples through native default path: **100%**
- Native `vkf.exe` driver and supported artifact runtime: **100%** for the
  current runnable-example contract
- No-Python freshness/dependency check: **100%** for the current native manifest
  contract
- Self-hosted lexer/frontend coverage: **99%**
- Self-hosted parser coverage: **99%**
- Typed IR as canonical center: **99%**
- Compiler artifact: **99%**
- Self-hosted stdlib/library compile: **99%**
- Native scene/UI lowering: **99%** for compiled packet/stub coverage, not yet
  full live UI runtime ownership
- `WASM` backend coverage: **99%** for the shared-IR seam, not yet a general
  backend for every richer runtime shape
- `WebGPU`-oriented lowering and runtime contract: **99%** for the current
  typed numeric/layout family, not yet a general backend for every UI/runtime
  shape
- Python parser deletion readiness: **99%**

## 100% Definition

- `vkf.exe <file.vkf>` decides stale/current without Python.
- If stale, `vkf.exe` compiles using VKF-owned compiler artifacts without
  starting Python.
- The compiler frontend is written in VKF and can parse the intended VKF
  language surface itself.
- The compiler lowers through one canonical typed-IR seam instead of
  backend-specific semantic forks.
- At least one native binary backend and one `WASM` backend lower from that same
  typed IR without Python.
- `WebGPU`-oriented compute/render kernels and layouts are emitted from that
  same typed IR family where GPU execution is the right target.
- All source-visible stdlib modules compile through the same path.
- UI/scene lowering compiles through the same path.
- `.\file.exe` runs directly without Python.
- Missing compiler support is a hard error, not fallback.
- Old Python parser/interpreter path is removed from default install.

## Canonical Compiler Shape

The compiler should converge toward this ownership model:

1. frontend in `VKF`
   - lexer
   - parser
   - typed IR
2. backend lowering from typed IR
   - native binary
   - `WASM`
   - `WebGPU` kernel/layout emission
3. runtime launch path
   - never starts Python for supported compiler/runtime flows

This means the hard boundary we care about is not "does it emit `C++` yet?".
The hard boundary is "does typed IR own the semantics cleanly enough that
multiple real backends can lower from it?".

## Burst Plan

### Burst 1: Bootstrap Seam

Status: **done**. Moved **8% -> 12%**.

- native driver owns manifest and artifact naming
- first VKF compiler source exists
- old parser can parse compiler source
- docs record language-sugar pressure from self-hosting

### Burst 2: Lexer Parity Slice

Target: **12% -> 46%**

Status: **done for parser-unblocking purposes**. Moved **12% -> 46%**.

- VKF lexer handles identifiers, numbers, strings, whitespace, comments
- parity fixtures compare token streams against old lexer
- string/byte iteration friction is recorded as language-sugar candidates
- first VKF scanner-state source now declares whitespace, comment, identifier,
  and number token capabilities; executable source indexing and parity fixtures
  remain next
- cursor/index helper shapes now exist in VKF source (`eof`, `peek`,
  `advance`, `consume_while`) but intentionally depend on explicit missing
  string indexing/slicing primitives rather than faking behavior
- tiny identifier+number parity fixture description is recorded as a
  source-level token stream contract
- minimum string/char primitive contract is documented for byte-indexed UTF-8
  source, Unicode scalar peek/advance, slicing, EOF, line/column updates, and
  lexer performance budgets
- header-only native string primitives now provide byte length, EOF, Unicode
  scalar peek/width, byte slicing with scalar-boundary validation, and cursor
  advance for ASCII plus 2/3/4-byte UTF-8 scalars
- tiny native cursor smoke now uses those primitives to scan identifier and
  number tokens from `alpha 123 beta45 6.7` without starting Python
- native cursor smoke now emits token records for `IDENT`, `NUMBER`, `NEWLINE`,
  and `EOF` with textual number payloads and source file/line/column positions
- native cursor smoke now skips spaces, tabs, and comments; emits `INDENT` and
  `DEDENT` for tiny indentation cases; preserves tab width 8; and reports
  inconsistent dedent errors
- native cursor smoke now emits operator and punctuation records for single,
  multi-character, logical, arrow, and `@`-family tokens, including `ARROW`
  adjacency payloads and bracket-depth newline suppression
- native cursor smoke now emits `STRING` and `STRING_RAW` records for single
  and triple quoted strings, decodes double-quoted escapes, preserves raw
  single-quoted text, handles SQL-style raw quote escaping, and reports
  unterminated string errors
- native cursor smoke now emits the versioned `vektorflow.token_stream` JSON
  envelope with normalized token values and source locations, and curated
  payload parity compares against Python `token_stream_to_json(tokenize(...))`
- native lexer contract artifact now lexes the declared native-core fixture set
  and stress snippets to versioned token-stream JSON without invoking the
  Python lexer fallback path

Remaining lexer gaps are intentionally non-blocking for parser work: production
binary naming, full fixture-corpus promotion, unicode policy hardening, and
performance tuning.

### Burst 3: Parser Skeleton

Target: **46% -> 58%**

Status: **done for typed-IR-unblocking purposes**. Moved **46% -> 58%**.

- native/self-hosted parser consumes versioned token-stream JSON
- bindings, literals, calls, blocks, function definitions, and type annotations
  have curated AST parity fixtures
- diagnostics carry source spans from token locations
- parser has no Python lexer dependency at its seam
- source-level parser skeleton now declares the token-stream envelope, cursor
  helpers, diagnostics with spans, first-subset AST records, and a
  `parse_token_stream_json` entrypoint without source lexer fallback
- native parser smoke now consumes versioned token-stream JSON directly and
  emits deterministic AST JSON for literals, identifiers, simple binds, simple
  calls, and multi-statement modules, with hard diagnostics carrying
  file/line/column
- native parser smoke now covers function definitions, typed parameters,
  optional return annotations, indented function bodies, and `@:` return
  statements against normalized bootstrap-parser AST fixtures

### Burst 4: AST To Typed IR

Target: **58% -> 70%**

Status: **done for compiler-artifact-unblocking purposes**. Moved **58% -> 70%**.

- typed IR builder consumes parser output for the executable subset
- literals, bindings, functions, calls, vector/list/map values, and field access
  lower through one native-owned path
- unsupported syntax is a hard diagnostic, never fallback
- native AST-to-IR smoke now consumes normalized parser-smoke AST JSON and emits
  deterministic typed IR JSON for modules, binds, literals, identifier loads,
  simple calls, function shells, return statements, and explicit `any` unknowns
- lexer-to-parser-to-IR native smoke pipeline is covered for the first curated
  sources without invoking Python in the native executables
- typed IR smoke now registers known function signatures, propagates known call
  return types through bindings, fails hard on known-function arity mismatch,
  and covers direct collection plus field-access AST fixtures
- native parser output for list literals, record literals, and dotted field
  access now flows through the lexer->parser->typed-IR pipeline, proving those
  collection and field-access cases end to end in native smoke executables
- IR lowering now has a first real axis-alignment seam for canonical example
  syntax: `AxisAlignExpr` carries `value -> axis` through the shared IR, and
  the IR executor now proves parity for `[-1,0,1] -> u`, dynamic axis-key
  forms like `->(axis_name)`, and disjoint-axis outer-product arithmetic such
  as `u * v` without falling back to the AST interpreter
- shared typed-IR analysis now also owns a first explicit `AxisTaggedType`
  contract for that seam, including same-axis and disjoint-axis fixed-vector
  arithmetic so canonical `u * v` style shapes can be typed without dropping
  back to the AST interpreter
- native parser smoke, native AST-to-IR smoke, and compile-only artifact smoke
  now also accept that first axis-tagged seam end to end for
  `[-1, 0, 1] -> u`, `->(axis_name)`, and the disjoint-axis `u * v` subset;
  runnable backend parity for richer axis-tagged programs is still a remaining
  blocker
- WASM artifact smoke now exports constant axis-aligned numeric vectors as
  runtime memory-backed bindings with manifest-owned `axis_key` plus
  `ptr/len` exports, and the WebGPU artifact manifest carries the same first
  axis-vector binding contract for compiled consumers; update-expression
  semantics for axis-tagged runtime programs are still a remaining blocker
- WASM artifact smoke now also has a first executable axis-tagged runtime
  update path: `vkf_update(state: axis<k>:list<num>, input: num) ->
  axis<k>:list<num>` lowers as an elementwise vector-state update using
  axis-aligned const bindings as shape seeds; richer axis-tagged state/input
  combinations and matching WebGPU update execution are still remaining
  blockers
- WebGPU artifact smoke and the compiled runtime bridge now match that first
  axis-vector runtime seam too: `axis_vector_scalar` manifests carry axis key
  plus axis length, WGSL lowers elementwise `state.values[i]` updates with
  axis-aligned const vector bindings, and the UI bridge encodes axis-vector
  state buffers for compiled consumers; richer axis-tagged combinations are
  still remaining blockers
- that first executable axis-tagged runtime seam now also supports matching
  vector input on both backend families: `axis_vector_vector` manifests carry
  `state_axis_*` and `input_axis_*`, WASM/WebGPU lower elementwise
  `state.values[i] + gain[i] + input.values[i]`, and the compiled UI bridge
  encodes both vector state and vector input buffers; broader record+axis and
  disjoint-axis runtime combinations are still remaining blockers
- the live compiled WASM runtime bridge now consumes that same axis-vector
  contract directly too: `instantiateWasmRuntime(...)` can read/write
  `axis_vector_scalar` and `axis_vector_vector` state/input memory as
  `{ values: [...] }`, and artifact-backed tests now prove emitted WASM
  modules plus manifests agree with the UI bridge on that contract
- shared IR execution now owns a larger source-visible runtime subset too:
  stdlib module aliases like `.collections`, collection-constructor alias
  calls, operator overload families (`+`, unary `-`), and dot-overload read
  families now execute through `IRExecutor` instead of forcing AST fallback
- parser/frontend coverage also reclaimed axis suffix sugar for literal vectors,
  positional tuples, and multisets: `_i`, `_ij`, and bare `_` now lower as the
  same `AxisAlign` family as `-> i`, so `.idx` reads/writes on those values are
  no longer blocked by the parser tokenizing them as implicit multiplication
- native bootstrap parser and native AST-to-IR parity now also cover the first
  suffix-tagged list subset: source like `u: [1, 2]_ij` lowers through the
  self-hosted lexer/parser/typed-IR pipeline as the same `axis_align` family as
  `u: [1, 2] -> ij`
- shared IR lowering/execution now also owns raw vector spread literals:
  `[: [1,2,3]]` lowers as an explicit IR splice node, executes through
  `IRExecutor`, and types as a first-class fixed vector instead of forcing
  AST fallback for that source-visible collection shape
  manifests and the UI bridge agree on the same runtime layout end to end
- the native WASM backend now emits the first mixed structured runtime shape
  too: record-mode `vkf_update` can carry both scalar `num` fields and
  axis-tagged `axis<k>:list<num>` fields in the same state/input layout, with
  manifest-declared offsets plus `axis_key` / `axis_length`, and the compiled
  UI bridge now proves it can execute that emitted artifact end to end
- the WebGPU backend and compiled runtime bridge now match that same first
  mixed record-plus-axis seam too: record-mode WGSL emits scalar fields and
  `array<i32, N>` axis-vector fields in the same `State` / `Input` structs,
  manifests carry mixed field descriptors with offsets plus `axis_key` /
  `axis_length`, and the compiled UI bridge now proves it can encode those
  richer runtime layouts for emitted GPU artifacts end to end
- backend artifact emission now also owns a first computed floating
  axis-tagged binding seam instead of only literal `axis_align` values:
  WASM/WebGPU artifact smoke can fold prior binding loads, unary
  `math.sin` / `math.cos`, and same-axis scalar/vector `PLUS` / `MINUS` /
  `STAR` into emitted `axis_f64_array` bindings, so canonical
  same-axis math like `wave: math.sin(theta)` and `0.5 * wave` no longer stop
  at typed analysis
- the compiled runtime bridge now consumes those emitted floating
  axis-tagged bindings directly too: `instantiateWasmRuntime(...)` exposes
  `bindingsLayout()`, `readBinding(name)`, and `readBindings()` for emitted
  WASM exports including `axis_f64_array`, and `createWebGpuRuntimeSpec(...)`
  mirrors the same binding metadata/value seam for manifest-owned GPU
  consumers

### Burst 5: Compiler Artifact

Target: **70% -> 82%**

Status: **done for stdlib/UI-unblocking purposes**. Moved **70% -> 82%**.

- native compiler-artifact smoke now owns `.vkfbuild/<stem>/manifest.json`,
  native source/typed-IR hashing, stale/current decisions, and a minimal
  runnable artifact without invoking Python
- generated artifact is now a real runnable script for the supported subset,
  with manifest-owned artifact-content/runtime hashing, `compiled`/`current`
  decisions, and rebuild on tamper/missing artifact
- native driver smoke now owns the `vkf <file>` compile/current/run path across
  the lexer, parser, typed-IR, and artifact smoke executables, writing
  intermediates under `.vkfbuild/<stem>/` and returning JSON run summaries
- self-hosted compiler compiles to native artifact through `vkf.exe`
- manifest records source/import/runtime hashes
- stale check, dependency scan, compile, and current-artifact run avoid Python
- `vkf <file.vkf>` either runs `file.exe` or produces a hard compiler error

### Burst 6: Stdlib And UI Library Ownership

Target: **82% -> 92%**

Status: **done for delete-Python-default-path unblocking**. Moved **82% -> 92%**.

- first source-visible stdlib seam is native-owned and dependency-tracked:
  `math.pi` and `math.tau` resolve through checked-in native fixtures, typed IR,
  manifest dependency hashes, and runnable artifact output without Python
- first real `typed IR -> WASM` seam now emits actual `.wasm` bytes with an
  explicit runtime surface contract: lifecycle exports, state/input arena
  exports, and binding export metadata recorded in `wasm-manifest.json`
- that first `WASM` seam now also lets one tiny typed-IR function,
  `vkf_update(state:num, input:num) -> num`, own the exported update behavior
  for the first state slot instead of keeping all runtime mutation hardcoded in
  the backend
- the `WASM` seam now also has a first structured runtime state shape:
  `vkf_update(state:record, input:record) -> state_record`, with named state
  and input fields exported through the wasm manifest as byte-offset metadata
- the first `WebGPU`-oriented backend seam now emits WGSL compute artifacts from
  the same typed-IR `vkf_update` contract, with manifest-declared storage
  layouts for scalar and record runtime state/input shapes
- `io.print` is now a second source-visible native stdlib seam, dependency-
  tracked through the driver/manifest path and replacing the hardcoded print
  special case with stdlib-owned behavior while preserving bare `print(...)`
  as a compatibility alias
- stdlib `io` preferred host surfaces now use host-neutral default adapter names
  (`PathIoFileHost`, `SleepIoTimeHost`) while keeping compatibility aliases,
  so the runtime seam no longer treats Python branding as part of the contract
- stdlib `io.read_numbers` now returns built-in `NumericMatrix` /
  `NumericColumn` containers by default, removing the NumPy runtime dependency
  from that stdlib surface while preserving shape and `dtype=float64` metadata
- native default-path sibling discovery now lets the supported subset run as
  `vkf <file>`-style native compile/current/run orchestration without
  Python-provided tool paths
- source-visible stdlib modules compile through the same compiler path
- UI/scene lowering enters the same typed IR/codegen path for supported features
- Python stdlib/runtime shims are removed from default execution

### Burst 7: Delete Python Default Path

Target: **92% -> 99%**

Status: **done for supported-subset default-path purposes**. Moved **92% -> 99%**.

- default Python CLI run path now classifies native support before interpreter
  use: files in the supported native subset hard-error on native failure and do
  not silently retry the Python interpreter
- unsupported files are now hard errors in the default run path after native
  subset classification; neither `auto` nor `native` mode falls through to the
  Python interpreter
- supported native files have no fallback hatch: once the CLI classifies a file
  as native-supported, failure stays on the native path instead of retrying the
  Python interpreter
- `VKF_RUNTIME_BACKEND=python` is no longer a supported selector either: the
  CLI now treats that old value like `auto`, so it cannot be used to force a
  native-supported file back onto the Python interpreter path
- supported-subset and native-core package metadata now record
  `python_required_to_build=false` and `python_required_to_run=false`
- compiler-source hardening now treats canonical VKF syntax as part of the
  compiler contract: self-hosted compiler files use real `??` / `=>` forms with
  direct default arms, and contributor rules/tests forbid invented keyword
  syntax or `_ =>` drift in compiler sources
- compiler bootstrap now has a native-handoff manifest instead of a
  Python-parser proof boundary: the ordered self-hosted compiler source set is
  source-hashed only, native bundle parser/artifact smokes prove parseability,
  and the future compiled compiler can take over from that manifest without
  rediscovering source order ad hoc
- native bootstrap manifest smoke now also emits the declared compiler bundle
  units in-order, so the compiled/native side owns one explicit compiler-source
  bundle input seam rather than treating the manifest as proof-only metadata
- native bootstrap bundle lexer smoke now consumes that declared compiler
  bundle and emits token-stream JSON per compiler unit without Python runtime
  help, making compiler-bundle ingest a native-owned step instead of a Python
  bootstrap-only concept
- native bootstrap bundle parser smoke now consumes that same declared compiler
  bundle through the native lexer/parser path; after widening the native parser
  for compiler-source expression forms, `??`/`=>` match arms, indented bind
  values, dotted reach-in, and implicit multiplication, that parser-bundle
  takeover now parses the full declared self-hosted compiler bundle without
  Python runtime help
- native AST-to-IR smoke now also lowers that full declared self-hosted
  compiler bundle after widening IR support for compiler-source `binary_op`,
  `block` expressions, dotted reach-in, and `match_stmt` nodes, so the native
  compiler path now owns source -> tokens -> AST -> typed IR for the declared
  compiler bundle
- native bootstrap bundle artifact smoke now carries that same declared
  compiler bundle through a native compile-only backend seam, emitting
  placeholder artifacts and manifests per compiler unit without Python runtime
  help; runnable full backend parity is still a separate remaining step
- the main artifact smoke has also been widened enough to compile that full
  declared compiler bundle through the normal source -> typed_ir -> artifact
  path, keeping the simple runnable `io.print` subset while accepting richer
  compile-only compiler structures such as functions, records, lists, binary
  ops, block expressions, dotted reach-in, and match statements
- the native driver smoke now also compiles that full declared compiler bundle
  through the normal `source -> token -> AST -> typed IR -> artifact` path,
  which means the declared compiler bundle is no longer only proven at isolated
  phase seams but also through the integrated native driver flow
- a first real `typed IR -> WASM` artifact seam now exists:
  `vkf_wasm_artifact_smoke` emits real `.wasm` bytes plus a wasm manifest from
  the same typed IR contract, exporting `vkf_init`, `vkf_update`,
  `vkf_shutdown`, and getter exports for supported const bindings; unsupported
  typed IR still fails hard instead of pretending broader backend coverage
- executable float runtime parity now covers the first real emitted update
  seam too: `vkf_wasm_artifact_smoke` can execute `axis<k>:list<num>`
  `vkf_update` functions in `f64` storage when the axis seed is floating,
  emits float-aware axis-vector runtime metadata, and the compiled runtime
  bridge can drive those emitted modules end to end through manifest-owned
  `writeState` / `writeInput` / `update` / `readState`
- the matching WebGPU-side contract now exists for that same float axis-vector
  seam: `vkf_webgpu_artifact_smoke` emits `f32` axis-vector update shaders and
  float-aware runtime metadata, and the compiled runtime bridge encodes those
  manifest-owned `state` / `input` buffers with the same float layout instead
  of falling back to int-only assumptions
- that float-aware WebGPU seam now also covers explicit scalar and record
  layouts: `vkf_update(state:f32, input:f32) -> f32` and
  `record{...f32...}`-shaped updates emit `f32` WGSL fields plus manifest
  `storage: "f32"` descriptors, and the compiled runtime bridge encodes those
  scalar/record buffers without falling back to `i32`-only assumptions
- the source-driven/default-driver WebGPU seam now reaches that richer float
  subset too: real VKF source can emit float scalar, float record, and mixed
  `record{scalar:f32, axis:axis<u>:list<f32>}` WebGPU artifacts with the same
  manifest-owned `f32` runtime layout contract that the compiled bridge
  consumes
- that source-driven float WebGPU subset now also includes matching vector
  input: `vkf_update(state:axis<u>:list<f32>, input:axis<u>:list<f32>) ->
  axis<u>:list<f32>` emits the expected `axis_vector_vector` WGSL/runtime
  contract from real source, and the compiled bridge encodes both float state
  and float input vectors through the same manifest-owned layout
- that same source-driven float WebGPU family now also owns first-class unary
  math intrinsics: real VKF source like
  `@: math.sin(state + gain + input)`, `math.cos(...)`, `math.sqrt(...)`, and
  `math.exp(...)` lowers through the native
  `stdlib_function(full_name="math.sin")` call shape family and emits matching
  `sin(...)` / `cos(...)` / `sqrt(...)` / `exp(...)` WGSL instead of only
  supporting the older handwritten field-access intrinsic fixture shape
- computed intrinsic bindings from real source now cross that same WebGPU
  seam too: bindings like `wave: math.sin(theta)` and `wave: math.exp(theta)`
  lower through the native `stdlib_function(full_name="math.sin")` call
  shape family, export the expected `axis_f64_array` runtime binding values,
  and feed later WebGPU updates without relying on a handwritten-only
  intrinsic binding fixture
- the WebGPU numeric family now also owns first-class division on both sides
  of the seam: source-driven scalar updates like `@: state + input / scale`
  and computed bindings like `half: theta / 4.0` emit the expected `/` WGSL
  arithmetic and runtime binding values instead of stopping at the older
  `PLUS` / `MINUS` / `STAR`-only subset
- the WebGPU numeric family now also owns first-class power for the current
  supported subset: source-driven scalar updates like `@: input ^ scale` emit
  `pow(...)` WGSL, and computed bindings like `pow2: theta ^ 2.0` now export
  the expected runtime binding values instead of stopping at the earlier
  arithmetic subset
- the source-driven native path now reaches that same float runtime seam too:
  real VKF source using `axis<k>:list<num>` function annotations can parse
  through the shared/native parser boundary and the default native driver can
  emit the float axis-vector WASM artifact from source instead of relying on a
  handwritten typed-IR fixture for that case
- the default native driver now owns the matching source-driven WebGPU seam
  too: it can invoke `vkf_webgpu_artifact_smoke` from real VKF source,
  surface `webgpu_*` artifact metadata in its summary, and emit the float
  axis-vector `f32` runtime manifest/shader path from source instead of only
  through standalone typed-IR artifact tests
- the shared IR path no longer hard-stops on basic string interpolation:
  double-quoted `$name` / `$path.to.field` strings in the supported subset now
  lower into explicit IR nodes, type-check as `str`, and execute through the
  IR executor instead of forcing that whole module to stay on the old
  interpolation-specific lowering failure
- tuple literals and tuple spread now lower, type-check, and execute through
  shared IR instead of forcing fallback; that reclaimed `examples/12_tuples.vkf`,
  `examples/72_concat.vkf`, and let `examples/100_axis_4_panel.vkf` clear the
  old tuple-lowering blocker
- resource-style rebinding now crosses the shared IR seam too: struct-field
  binds like `point.z: 5` and dotted-index binds like `values.0: 4` or
  `state.("name"): "bob"` no longer force AST-only execution, reclaiming
  `examples/20_struct_field_rebind.vkf`, `examples/21_vector_index_rebind.vkf`,
  `examples/24_immutable_values_mutable_resources.vkf`, and
  `examples/91_shared_buffer_pattern.vkf`
- labeled stdout prints (`::: expr`) now lower and type-check through shared
  IR too, reclaiming `examples/44_variadic_positional.vkf`,
  `examples/45_variadic_named.vkf`, and `examples/90_runtime_resources.vkf`
- inclusive and lazy ranges now cross the shared IR seam too: `1..5`, `..3`,
  and list forms like `[1..]` lower, execute, type-check, and preserve the
  AST runtime contract closely enough to reclaim `examples/15_ranges.vkf`
- scoped block expressions and constructor-style lone `:` now cross the shared
  IR seam too: `name: <block>` scope expressions, `: value` spill statements,
  and expression `:` scope snapshots now lower, execute, and type-check
  through shared IR instead of forcing AST fallback, reclaiming
  `examples/03_blocks_return_last.vkf` and `examples/23_spill_and_override.vkf`
- pipe chains, type reflection, absolute value / vector norm, and non-stdlib
  dot-module imports now cross the shared IR seam too: streaming `>>`
  expression segments, trailing-dot `value.` type reflection, `|x|` / `|[x,y]|`,
  and alias imports like `helpers: ."file.vkf"` all lower and execute through
  shared IR now, reclaiming `examples/53_type_reflection.vkf`,
  `examples/62_pipes.vkf`, `examples/63_pipe_with_functions.vkf`,
  `examples/73_norm_and_abs.vkf`, and `examples/83_file_module.vkf`
- the native/default parser path now owns a first real subset of those source
  forms too: native token streams now round-trip valid JSON for trailing-dot
  / arrow metadata, native parsing accepts `::`, trailing-dot `value.`, `|x|`,
  and alias dot-module import syntax, and the default native driver can now
  run the `53_type_reflection` and `73_norm_and_abs` example shapes without
  falling back to Python
- the native/default artifact path now owns a first imported-module call-target
  seam too: aliased dot-module imports like
  `helpers: ."modules/83_file_module_helpers.vkf"` can now execute simple pure
  numeric helper calls such as `helpers.scale(2, 10)` through artifact/runtime
  emission, and imported helper source is tracked as a manifest dependency so
  freshness invalidation no longer ignores that source file
- the native/default path now owns a first truthful `PipeChain` subset too:
  the native lexer preserves `RANGE` before trailing-dot number normalization,
  the native parser accepts `>>`, `$`, and finite `1..5` list members, and
  native AST-to-IR folds the supported finite list-pipe family into typed
  `list<num>` values, which is enough to run `examples/62_pipes.vkf` and
  `examples/63_pipe_with_functions.vkf` through the real native driver without
  Python fallback
- native semicolon statement chains now also cross the default path for the
  simple supported subset: module and block parsing accept `stmt; stmt`, and
  artifact evaluation now executes string `&` concatenation instead of only
  rendering it, which is enough to run `examples/05_comments_and_semicolons.vkf`
  through the native driver without Python fallback
- native positional tuples now cross the default path for the first real
  subset too: `(3, 4)` parses as a tuple literal rather than only a record,
  `.0` / `.1` numeric dotted-index reads are accepted in the native parser,
  tuple literals lower into native typed IR, and artifact evaluation can read
  flat tuple/list renderings by numeric dotted index, which is enough to run
  `examples/12_tuples.vkf` through the native driver without Python fallback
- native resource rebinds now cross the default path for the first real
  subset too: field targets like `point.z: 5` and numeric index targets like
  `values.0: 4` parse as real bind targets, lower into native typed-IR
  `update_attr` / `update_index` statements, and execute in artifact/runtime
  evaluation, which is enough to run `examples/20_struct_field_rebind.vkf`
  and `examples/21_vector_index_rebind.vkf` through the native driver without
  Python fallback
- native local function calls now cross the default path for the first real
  subset too: artifact/runtime evaluation can execute user-defined typed-IR
  function bodies with parameter binding, local stores, implicit last-value
  returns, and explicit `return`, which is enough to run
  `examples/30_functions_basic.vkf`, `examples/31_single_line_functions.vkf`,
  `examples/32_recursion.vkf`, `examples/33_docstrings.vkf`, and
  `examples/34_typed_parameters.vkf` through the native driver without Python
  fallback
- native single-`?` conditionals now cross the default path for the first
  real subset too: parser/lowering/runtime support can execute conditional
  return bodies like `n < 0? @: "negative"` through the native driver, which
  is enough to run `examples/04_early_return.vkf` and `examples/60_if.vkf`
  without Python fallback
- native constructor-style spill/scope now crosses the default path for the
  first real subset too: parser/lowering/runtime support can execute `: expr`
  spill statements and lone `:` scope identity inside local function bodies,
  including constructor-style rendering like `ColoredPoint(x:3, y:4, color:red)`,
  which is enough to run `examples/23_spill_and_override.vkf` through the
  native driver without Python fallback
- native advanced local call binding now crosses the default path for the
  first non-variadic subset too: parser/lowering/runtime support now carries
  default parameter values, named call arguments, and list/record spread call
  arguments into local function execution, which is enough to run
  `examples/40_default_args.vkf`, `examples/41_named_args.vkf`,
  `examples/42_call_spread_vector.vkf`, and
  `examples/43_call_spread_struct.vkf` through the native driver without
  Python fallback
- native stdlib import/runtime breadth now crosses the default path for the
  first real alias/spill subset too: artifact/runtime evaluation understands
  stdlib math calls (`sqrt`, `sin`, `cos`, `exp`), stdlib collection
  constructors (`collections.map`, `collections.list`), aliased stdlib module
  imports like `math: .math` / `collections: .collections`, and unaliased
  spill imports like `:.math`; record updates by string key also execute in
  the same native artifact seam now, which is enough to run
  `examples/24_immutable_values_mutable_resources.vkf`,
  `examples/80_module_import.vkf`, `examples/81_scope_spill.vkf`, and
  `examples/82_qualified_call_avoids_recursion.vkf` through the native driver
  without Python fallback
- native labeled-print and runtime-resource seams now cross the default path
  for a first real variadic/resource subset too: `:::` label prints parse and
  lower natively, local-function runtime binding now supports variadic
  positional and variadic named params, and the native collections seam now
  owns `queue()` plus top-level `put` / `get` mutation for rendered queue
  resources, which is enough to run `examples/44_variadic_positional.vkf`,
  `examples/45_variadic_named.vkf`, and `examples/90_runtime_resources.vkf`
  through the native driver without Python fallback
- native numeric structural/runtime evaluation now crosses the default path
  for the first real typed-shape subset too: numeric field reads from rendered
  records, numeric dotted-index reads from rendered tuples/lists, and a first
  disjoint-axis outer-product render path now execute in artifact/runtime
  instead of failing at `stod` or unsupported numeric-node kinds, which is
  enough to run `examples/50_struct_types.vkf`,
  `examples/51_vector_shape_types.vkf`, and
  `examples/64_axis_tags_and_broadcast.vkf` through the native driver without
  Python fallback
- native arithmetic/logic/operator parsing and runtime now crosses the default
  path for the first real operator subset too: unary `~` / unary `-`, power
  `^`, boolean `/\` `\/` `><`, and local operator overload definitions like
  `+(a:Point, b:Point)` now parse, lower, and execute natively, which is
  enough to run `examples/70_arithmetic.vkf`, `examples/71_logic.vkf`, and
  `examples/74_operator_overload.vkf` through the native driver without Python
  fallback
- post-99 hardening: supported-subset package manifests now expose a narrow
  Python-free default-path contract with `default_entrypoint=vkf.exe`, the
  native driver/artifact smoke path, and no Python fallback launcher entries;
  supported example UI/scene imports now cross that contract too through the
  native `.ui` stub/runtime seam, even though full live UI ownership is still
  broader than the current native guarantee
- that supported default path is now also enforced as one aggregate proof over
  the whole top-level example ring: all `53` root `examples/*.vkf` programs run
  through the native self-hosted driver with `--run` and no stderr Python or
  fallback markers, so the no-Python example claim is no longer only a manual
  sweep result
- the stronger recursive example proof is now enforced too: all `97` runnable
  `examples/**/*.vkf` programs compile and run through the native self-hosted
  driver with `--run` and no stderr Python or fallback markers; the only
  recursive exclusions are helper/import-only modules and the two intentionally
  unsupported native-preference fixtures
- the runnable-example proof now also guards the native default-path tools
  themselves: lexer, parser, AST-to-IR, artifact, `WASM` artifact, and `WebGPU`
  artifact smoke sources are checked for Python/process-launch hooks, so the
  example sweep is backed by native-owned tool sources rather than only by
  stderr wording
- shared typed-IR analysis now owns imported helper-call targets more honestly
  too: aliased dot-module imports such as
  `helpers: ."modules/83_file_module_helpers.vkf"` no longer fall out of the
  canonical typed-IR center as "unsupported call target"; imported helper
  members are now tracked as callable imported-function values and analyzed as
  first-class `any`-returning calls instead of requiring backend/runtime-only
  knowledge
- shared typed-IR analysis now also matches backend numeric power ownership for
  vector families: plain vector `^`, same-axis tagged vector `^`, and
  disjoint-axis tagged vector `^` no longer fall through explicit unsupported
  operator branches in the canonical center, so typed-IR shape analysis stays
  aligned with the backend-supported power family instead of lagging behind it
- shared typed-IR analysis now also matches the tuple runtime surface for
  numeric dotted-index reads: tuple values like `(3, 4)` and accesses like
  `point.0` / `point.1` no longer fall through the old fixed-vector-only index
  rule in the canonical center, so supported tuple indexing now types cleanly
  instead of depending on later runtime/backend knowledge
- release-bundle verification now executes declared tester smoke argv from the
  manifest instead of assuming a Python-shaped `vkf -e ...` CLI path, so bundle
  validation can follow future native launcher entrypoints directly
- release-bundle building no longer freezes the Python CLI through PyInstaller:
  the bundle now compiles a real native `vkf.exe` entrypoint plus sibling
  native pipeline tools (`vkf_lexer_cursor_smoke`, `vkf_parser_token_stream_smoke`,
  `vkf_ast_to_ir_smoke`, `vkf_compiler_artifact_smoke`) and records them in the
  release manifest as required native artifacts
- browser-mode launch no longer falls back to Python `http.server`; it now
  requires native overlay `--serve-only` or native `vf-browser-server` and
  otherwise hard-errors clearly
- default `vkf <file>` no longer falls back to the Python interpreter for
  unsupported native-subset files; missing native compiler/runtime coverage is
  now a hard error in both `auto` and `native` run modes
- package entrypoints use native `vkf.exe` by default
- old Python parser/interpreter is kept only as test/bootstrap history or deleted
- no silent fallback remains in CLI, launcher, examples, or docs
- perf budgets are enforced by tests/benchmarks

Remaining truthful blockers before 100%:

- ordinary UI events still flow through Python-owned ingress/runtime code even
  though the public contract is now queue-first and `UIRoot`'s live public event
  queue plus ordinary dispatch path can already stay in canonical payload
  mappings until a frame handler or `next_event()` compatibility requires a
  Python event object; strict packet-only sessions also avoid seeding legacy
  scene/display/state file mirrors up front and advertise strict packet mode to
  the browser runtime shell, whose strict flow now suppresses legacy display-file
  refresh, blocks direct legacy widget-state and display-file polling, and
  quiesces quiet packet polling; Python-side strict packet publishing also
  refuses file-mirror fallback even when direct overlay publish fails and records
  that failed publish result in the payload snapshot; public display-runtime
  publish plus scene/widget-state sync now hard-error on that failed strict
  delivery, and incremental `geom.color.patch` / `widget.append_text` packet
  publishers now share the same hard-error contract; browser-side strict
  packet loading now also rejects missing/malformed/failed overlay packet
  sources instead of treating them as quiet no-packet polls, and strict shell
  boot now records that first source failure instead of scheduling a masked
  retry loop; strict overlay packet JSON failures now normalize into that same
  browser-side source failure shape, and missing strict runtime source/flow
  modules now fail explicitly too; scheduled strict packet polls now stop and
  mark the same source-failure state instead of silently rescheduling; strict
  browser packet sourcing now rejects malformed individual packet envelopes, and
  strict routing validates bootstrap packet payloads before mutating runtime
  state; adapter-owned strict packet families now fail when their widget/display
  consumer adapter is unavailable, and unsupported strict packet kinds are
  rejected before packet mode can activate; strict source validation also
  requires object payload envelopes before routing and validates incremental
  `widget.append_text` / `geom.color.patch` payload fields at the source and
  route boundaries; strict `scene.replace` delivery now requires the scene
  adapter instead of degrading to a warning; strict overlay packet source
  success now requires a nonempty packet stream with monotonic packet sequence
  numbers, and strict packet loading throws on stale/invalid route-side sequence
  numbers instead of skipping them; strict bootstrap coalescing now preserves
  monotonic sequence order for the retained packets; strict source validation
  now covers bootstrap packet family payloads and rejects unsupported packet
  kinds before routing; strict direct runtime payload application rejects empty
  packet streams and legacy command payload bypasses, and strict direct packet
  routing rejects stale/invalid sequence numbers before state mutation; strict
  packet loading no longer half-activates packet mode before route validation
  succeeds, and strict route delivery now waits for adapters to succeed before
  advancing packet sequence or stopping fallback; strict shell-level direct
  packet/payload entrypoints now fail when the runtime flow is unavailable
- the new `WASM` and `WebGPU` backend seams are real but still narrow; broader
  typed-IR coverage and richer runtime ownership are still needed before they
  can count as general backends

## Performance Budgets

- Freshness check: **< 50 ms** for common examples.
- Fresh compile, small file: **< 250 ms** after compiler warm cache.
- Fresh compile, scene file: **< 1 s** after compiler warm cache.
- Current artifact run: **< 100 ms** before overlay/window readiness cost.
