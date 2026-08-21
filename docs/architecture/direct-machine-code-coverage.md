# Direct Machine-Code Coverage

Date: 2026-08-21

This inventory is the cutover map for ADR 0005. `Direct` means a VKF program
reaches a runnable PE/ELF/Mach-O without generating C++ or invoking a per-program
assembler, compiler, or linker. `Stage 0` means the broad C++ compatibility
path remains authoritative.

## Current Native Direct Slice

| Area | Direct now | Still Stage 0 |
| --- | --- | --- |
| scalar values | `num`, integer-surface numbers, `bit` represented in scalar registers; `null` as a stable bit-pattern sentinel; UTF-8 strings as pointer/signed-byte-count pairs, with borrowed literals and header-backed owned allocations | distinct integer/bit storage and conversions |
| scalar operators | unary `+`/`-`/not and custom unary overloads; `+`, `-`, `*`, `/`, `//`, `%`, power; short-circuit and/or, xor; IEEE-ordered comparisons; UTF-8 byte-lexicographic string equality/order; immutable string and dynamic numeric-list concatenation with owned-input cleanup; overload families selected by operand type; custom reach (`.`) and string conversion | import-provided operators |
| bindings | function locals, ordered top-level bindings, fixed vectors, tuples, records, primitive type handles and type-member spills; fixed/dynamic index and record-field updates plus record-field extension; scope spill composes constructor records; recursive resource ownership; captured multiline closures, lambdas, stored function values, nested local functions, and recursive local functions | imported module state and heterogeneous runtime-resource containers |
| control flow | conditional blocks, loop-form conditionals, block expressions, return/bare return, break/continue/program exit; `??` value/type/specificity ranking; assertion, checked-index, and checked-conversion errors propagate through calls, unwind owned locals, retain dynamic messages, and `!?` catches by most-specific type while exposing `$.message` | event patterns supplied by UI modules |
| calls | direct/recursive/local/higher-order calls; overload families; ordered named/default arguments; fixed-vector, tuple, and record spreads; homogeneous and heterogeneous positional variadics; heterogeneous named variadics; structural open-record projection; compatible literal projection for sparse nested vectors/records; automatic structural lifting of one-parameter functions over maximal compatible tuple/vector/record substructures; statically resolved closure/function values; compiler-private aggregate ABI and owned resource transfer | imported module data/functions and runtime-selected external function pointers |
| fixed aggregates | tuple/vector/record layout, display, exact/semantic equality, extension and persistent updates; scalar broadcast, elementwise operations, arbitrary-rank distinct-axis outer products, nested symbolic shapes, ranges and pipes; numeric and string multiset normalization/arithmetic on x64 and ARM64 | heterogeneous mutable runtime resources supplied by libraries |
| process output | zero, scalar/string, recursive bit/null/tuple/record/vector/multiset rendering; custom `::`/`str` rendering; interpolation and numeric formats; ordered mixed output plans; synchronous labeled/function output | UI/stream sinks supplied by libraries |
| artifacts | compiler-owned x64 PE imports/IAT with emitted-size-driven sections and per-program math/write/time imports; compiler-owned x64 ELF dynamic tables/GOT/relocations and direct stdout/time calls; compiler-owned ad-hoc-signed ARM64 Mach-O with emitted-size-driven segments, numeric formatting, math/time calls, allocation/error calls, large-frame stack adjustment, and literal-pool base in runtime ABI v18; installed execution proven on Windows x64, Linux x64, and macOS ARM64 | macOS x64; debug data |
| standard libraries | deterministic fixed/dynamic-list `stat`; explicit-state `random`; typed-record maps and numeric queues in `collections`; direct text/string-backed-byte file IO; explicit error construction, typed propagation, and catch ranking; host facts in `system`; synchronous exact-argv execution in `process`; native regular-expression search/capture with greedy backtracking; complete real-number `math` with structure-preserving elementwise lifting plus complex elementary operations; `time` validation, portable local/UTC formatting, pure UTC conversion, and direct clock/sleep/local-calendar capabilities | runtime-key maps, heterogeneous queues, numeric file parsing, alternate encodings, process options, advanced regular-expression syntax, complex continuations of inverse/special functions, arbitrary `strftime` format programs |

Unsupported imported/library IR is reported and routed explicitly to Stage 0.
Strict direct mode fails instead of changing semantics.

The complete `compiler/self_hosted/stdlib/physics.vkf` module currently reaches
a direct no-output PE. Its collision-matrix, contact-material, and rigid-body
smoke programs now recursively link their VKF modules and execute through the
direct Windows/Linux x64 path; the same linked typed IR also emits ARM64 Mach-O artifacts.
The self-hosted lexer seed now emits direct x64 and ARM64 artifacts too; only
its four top-level-reachable specialized scanner-state constructors are linked.

## Required Language and Ecosystem Surface

| Stratum | Required surface | Existing oracle during migration |
| --- | --- | --- |
| canonical semantics | all lexer/parser forms, diagnostics, type facts, axis/shape facts, symbolic facts | native C++ frontend plus language suite |
| calls and modules | overloads, defaults, named/variadic/spread arguments, recursion, file modules, stdlib imports | native typed-IR evaluator and C++ AOT |
| values and layout | strings, lists, fixed vectors, tuples, multisets, records/structs, axes, runtime resources | C++ AOT, WASM layout manifests, UI bridge tests |
| mutation model | rebinding, field/index updates, queue/resource operations, ownership and lifetime | C++ AOT and native artifact evaluator |
| stdlib | `math`, `stat`, `collections`, `io` | `compiler/self_hosted/stdlib/*.vkf` and stdlib tests |
| rigid physics | collision matrices, restitution/friction materials, coupled contact impulses, rigid-body mass and momentum stepping | physics stdlib tests and examples |
| symbolic | parsing, typing, relations, differentiation/integration/sums, constraints, sampling, rendering packets | symbolic kernel, WASM artifact, browser parity tests |
| UI/scene | scene packets, display packets, events, widgets, geometry buffers, runtime state and strict packet delivery | native scene compiler and browser/UI suites |
| target backends | native x64 first; WASM and WebGPU from the same canonical typed IR | current WASM bytecode emitter and WebGPU artifact emitter |
| compiler bootstrap | lexer, parser, typed IR, optimizer, machine IR, artifact writer written in VKF | versioned Stage 0 compiler and bootstrap bundle |

## Cutover Order

1. Introduce target-neutral machine IR and explicit Windows x64, SysV x64,
   macOS arm64/x64 ABI facts.
2. Complete scalar semantics and output/runtime calls.
3. Add fixed-vector and record layouts without heap allocation.
4. Add strings, dynamic collections, ownership, allocation, and cleanup.
5. Classify every stdlib operation as VKF source, intrinsic, or stable runtime
   ABI call; migrate by that classification.
6. Move physics, symbolic, and UI packet vertical slices with differential
   tests against Stage 0.
7. Make strict direct mode pass the full language, stdlib, example, UI, WASM,
   and WebGPU suites on Windows, Linux, and macOS.
8. Build Stage 1 with Stage 0, Stage 2 with Stage 1, and Stage 3 with Stage 2;
   require normalized Stage 2/3 fixed-point equivalence.
9. Make C++ fallback opt-in for one release, then remove it while retaining a
   versioned bootstrap seed.

No percentage is used as a deletion gate. A row moves from Stage 0 only when
its observable behavior, diagnostics, layout, and lifetime tests pass in
strict direct mode.

## Clean Core Boundary

The compiler-owned, import-free language core is complete at this boundary:
primitive handles/reflection, blocks/scopes, tuples, vectors, records, ranges,
numeric and string multisets, persistent updates, axes, complex numbers,
overload families, reach/display overloads, closures, lambdas, higher-order
calls, positional/named variadics, spreads, pipes, match/catch/assertion, and
owned strings/containers. The pure VKF suite proves 206 import-free test
functions; the full suite, including the temporary `.math` compatibility
import, proves 213.

Stop here. Imports are the boundary. The stdlib, symbolic system, physics, UI,
mutable runtime resources, and compiler self-hosting remain on the working C++
compatibility path until their later migration. They are not hidden additions
to this core.

## Automatic structural call lifting

For a one-parameter function call, the compiler first tries the argument as a
whole. If the argument is compatible, including through an ordinary implicit
conversion, it performs one normal call. This is how an explicit container
parameter requests whole-container behavior.

If the whole argument is not compatible and is a tuple, fixed or dynamic
vector, or record, the compiler descends until it finds maximal compatible
substructures. It calls the function at those locations and preserves every
incompatible field unchanged. Compatibility is the language conversion
relation, not a machine-layout guess: `int` can feed `num`, while `str` and
`bit` cannot. A record such as `(name:str, enabled:bit, x:int, y:int)` passed
to a `num -> num` function therefore transforms `x` and `y` only.

Each matched substructure is replaced by that call's result. Thus a `[int] ->
int` row function maps a fixed matrix to a vector of row results, while a
`[int] -> [int]` function preserves the matrix shape. Open container parameters
are specialized to compatible fixed rows for direct lowering.

Typed IR records the selected structural paths before scalar types are erased
by the numeric machine ABI. Fixed layouts lower to statically unrolled direct
calls. Dynamic numeric vectors are cloned once and updated by one direct O(n)
loop, with no user-authored loop or repeated concatenation. A container with no
compatible paths is preserved unchanged.

## Reproducible performance proof

The final proof uses identical generated inputs, fresh output artifacts, one
warmup plus 100 measured compilations, and five warmups plus 100 measured runs.
Compilation means source-to-runnable-machine-code. Raw VKF timing enters the
generated machine code directly and excludes process startup.

- Windows x64: `benchmarks/core-comparison/results/windows-20k-final-direct-libs.{json,md}`
- Windows x64 after structural-library extension: `benchmarks/core-comparison/results/windows-20k-extended-libs.{json,md}`
- Windows x64 after core structural calls: `benchmarks/core-comparison/results/windows-20k-structural-calls.{json,md}`
- Windows x64 after arbitrary-rank axis tensors: `benchmarks/core-comparison/results/windows-20k-axis-tensors.{json,md}`
- Linux x64 (Ubuntu 24.04 Docker): `benchmarks/core-comparison/results/core-final-linux-100.{json,md}`

The Windows 20,000-operation gate now measures fresh source-to-runnable-PE
compilation through a persistent compiler process, while retaining a fresh
source and fresh output artifact for every sample. Across 100 samples it
measured 10.095 ms mean compile time (50 ms gate) and 0.918 ms mean raw
machine-entry execution (1 ms gate). The raw metric intentionally excludes
Windows process startup; end-to-end process runtime is reported separately.

After the math/stat/random/time extensions, the same 100-sample Windows gate
measured 7.553 ms mean compile time and 0.414 ms mean raw machine-entry time.
The emitted benchmark machine code is byte-identical to the earlier proof, and
the regression comparator reports lower means for both metrics.

After automatic structural calls moved into the core, the same 100-sample gate
measured 5.436 ms mean compile time and 0.286 ms mean raw machine-entry time.
The emitted benchmark machine code remained byte-identical; the comparator
reported changes of -2.116 ms compile and -0.129 ms raw runtime against the
extended-library proof.

The current enforced limits are strictly under 10 ms mean compile time and
under 0.500 ms mean raw machine-entry time. After IO, random, errors,
collections, compatible aggregate projection, and rigid-physics ownership were
integrated, the 100-sample Windows proof measured 5.363 ms compile time and
0.405 ms raw machine-entry time. Fresh-process runtime remains a separately
reported Windows startup measurement.
