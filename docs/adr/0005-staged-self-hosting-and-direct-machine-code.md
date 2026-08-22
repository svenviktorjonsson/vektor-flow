# ADR 0005: Stage Self-Hosting Through Direct Machine Code

Date: 2026-08-19

## Status

Accepted. The narrow 20,000-operation performance gate described below was
superseded for release acceptance on 2026-08-22 by the full README example
matrix. It remains a historical microbenchmark.

## Context

ADR 0003 established a self-hosted, native-driven VKF compiler. The current
transition has two useful but incomplete paths:

- a C++ implementation covers the broad language and can emit or compile C++
- a narrow backend lowers scalar typed IR directly to x64 machine code

Removing the C++ path at once would break the language, stdlib, physics,
symbolic system, UI compilation, and shipped examples. Keeping it indefinitely
would leave VKF dependent on an external C++ compiler and linker.

## Decision

The compiler migrates by working bootstrap stages.

- **Stage 0** is the broad C++ compiler. It remains the compatibility compiler
  and semantic oracle during migration.
- **Stage 1** is the first VKF compiler built by Stage 0.
- **Stage 2** is built by Stage 1.
- **Stage 3** is built by Stage 2 and proves the bootstrap has reached a stable
  fixed point.

Every commit and every feature cutover must leave a usable compiler. Direct
machine-code coverage grows one semantic vertical slice at a time. Each slice
is compiled by both Stage 0 and the direct backend, compared through observable
behavior, then enabled in strict direct-only tests before its fallback is
retired.

The permanent pipeline is:

`VKF source -> canonical typed IR -> machine IR -> platform machine code -> executable artifact`

Normal VKF compilation must not generate C++ or invoke GCC, Clang, an external
assembler, or an external linker. The compiler owns instruction selection,
relocations, and PE/ELF/Mach-O artifact writing. The required native target
families are Windows x64, Linux x64, and macOS arm64, with macOS x64 retained
where the host can test it. Other targets such as WASM and WebGPU consume the
same canonical semantic IR through target-specific lowering.

The language ecosystem is inside migration scope:

- complete core language semantics and diagnostics
- stdlib and runtime ABI
- physics and symbolic modules
- UI scene and event compilation contracts
- WASM and WebGPU compilation
- all shipped examples

Desktop and browser hosts are not required to be rewritten merely because they
use C++. The dependency removed here is C++ from the VKF compiler pipeline.

## Cutover Rules

1. Fallback use is explicit in compiler output, manifests, and benchmarks.
2. Unsupported direct IR fails clearly in strict mode; it never silently
   produces a different artifact.
3. Typed IR preserves all layout facts needed by backends. Backends do not
   infer missing vector shapes, record fields, ownership, or lifetimes from
   benchmark source patterns.
4. Stdlib operations are classified as VKF source, compiler intrinsic, or
   stable runtime ABI calls.
5. Stage 2 and Stage 3 pass the same full suite and produce deterministic
   equivalent compiler artifacts after allowed metadata normalization.
6. C++ fallback becomes opt-in only after full strict-mode coverage, then is
   deleted after one deprecation release.
7. A versioned bootstrap seed, hashes, and rebuild procedure remain available
   after the normal C++ dependency is removed.
8. The final bootstrap path starts from that seed and does not require a C/C++
   compiler, assembler, linker, Python runtime, or platform SDK toolchain.

## Performance Measurement

Compilation reports frontend, optimization, code generation, relocation,
artifact writing, and external-tool time separately. Runtime reports program
execution separately from operating-system process startup. Performance claims
use 100 measured runs with warmups, mean, sample standard deviation, median,
p95, environment, source size, and artifact size.

The 5 ms runtime objective applies to program execution. End-to-end standalone
launch remains a separate target because process creation and security scanning
are platform and environment costs.

The 20,000-operation scalar-control acceptance budgets are under 10 ms mean for
fresh source-to-runnable-native compilation and under 0.5 ms (500 microseconds)
mean for raw machine-entry execution, each over 100 measured runs. The benchmark
runner enforces these as strict upper bounds. Fresh-process launch time is still
reported separately and cannot be hidden inside the execution number.

Perceived latency has a separate end-to-end gate. The exact interactive form
`vkf --aot -e "code"` must parse the source string, compile it to a native
executable, launch that executable, capture its output, and print the result in
under 103 ms mean over 100 measured runs. Compiler and generated-program
process startup count in this gate. No internal-stage timing may substitute for
it.

## Consequences

- C++ remains temporarily, by design, while direct coverage expands.
- Migration takes longer than replacing one backend, but each stage stays
  functional and releasable.
- Differential tests provide a safe oracle until the self-hosted compiler is
  independently complete.
- The compiler gains a stable machine IR and runtime ABI instead of embedding
  target assumptions throughout the frontend.
- Final builds no longer require a C++ toolchain to compile VKF programs or to
  rebuild the VKF compiler from its bootstrap seed.

## Rejected Alternatives

- **Big-bang VKF rewrite:** loses continuous parity and leaves long periods
  without a trustworthy compiler.
- **Permanent LLVM dependency:** removes generated C++ but does not meet the
  final compiler-owned machine-code pipeline.
- **Rewrite in Rust or another host language:** replaces one host dependency
  without reaching self-hosting.
- **Benchmark-only direct lowering:** improves selected numbers while leaving
  language semantics and ecosystem coverage behind.
