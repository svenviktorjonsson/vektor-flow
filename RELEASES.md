# Vektor Flow Native Releases

## 0.1.2 — Strict Bindings, Structural Updates, Typed Raises

0.1.2 closes concrete semantic and proof gaps found after 0.1.1:

- `name:value` only declares; `.name:value` only updates an existing binding;
- compound updates require a binding receiver: `.name +:value`, `.name -:value`, and related forms;
- declaration and update expressions return the stored value without walrus-style implicit outer mutation;
- parameters already exist in function scope, so `.x+:3` updates one while `x:4` is a duplicate declaration;
- structural compound arithmetic updates compatible numeric leaves while preserving incompatible metadata;
- `!` raises only typed error values or error types, never arbitrary values and never factorial;
- native `vkf -t` verifies expected compile failures as part of the VKF suite;
- native `vkf -v` identifies the embedded release and prevents stale-compiler proof;
- release documentation is split into a short landing page and complete numbered language guide;
- every documented example retains fixed work, exact output, and 100-run three-OS proof;
- a separate seven-language Linux comparison labels matched versus idiomatic algorithms, gives Python NumPy/SciPy and Julia optimized numerical routes, and links exact source.

The release gate is **296 VKF tests**, 59 documented-program checks, 100 fresh
compiles and 100 fresh-process runs per program on Windows x64, Linux x64, and
macOS ARM64, plus the pinned seven-language comparison. The container stress
workload remains fixed at 10 million element operations; it is never tuned to
produce a preferred duration.

Only `math`, `stat`, `random`, `time`, `io`, `collections`, `errors`, `system`,
`process`, and `regex` ship. `physics`, `ui`, and `symbolic` remain absent.

## 0.1.1 — Native Backend Parity

Vektor Flow 0.1.1 was one strict, native product on three targets:

| Target | Compiler | Archive | Installer |
| --- | --- | --- | --- |
| Windows x64 | `bin/vkf.exe` | `.zip` | per-user `.exe` |
| Linux x64 | `bin/vkf` | `.tar.gz` | `.deb` |
| macOS Apple Silicon | `bin/vkf` | `.tar.gz` | `.pkg` |

The installed compiler directly emits PE, ELF, or Mach-O programs. Compiling
and running VKF code does not invoke Python, a C++ compiler, an assembler, or a
linker. The release contains no compatibility fallback.

## 0.1.1 Changes

0.1.1 closes the backend and release-proof gaps found by executing every documented core feature:

- nested/local function registration, stored lambdas, and closures;
- fixed literal spread and fixed-shape classification;
- alias-preserving aggregate updates;
- named records nested in fixed container signatures;
- native complex output formatting;
- chained distinct-axis tensor products;
- local shadowing of stdlib module names;
- correct four-byte UTF-8 formatting and monotonic time on macOS ARM64;
- source-first regex capture documentation;
- integrated full-suite discovery and isolated native test artifacts;
- per-example 100-compile/100-run reports with exact output and host conditions;
- a documented 20-million-operation fixed-container stress workload.

0.1.0 remains the first native preview. Release history is retained in the main README.

## Included Standard Library

The complete 0.1.1 native surface is:

- `math`: real functions, elementary complex functions, structural lifting
- `stat`: deterministic fixed-vector and dynamic numeric-list statistics
- `random`: explicit, reproducible seed-threaded pseudo-random generation
- `time`: clocks, sleep, Gregorian UTC conversion, portable formatting
- `io`: stdin/stdout/stderr, UTF-8 text files, byte-exact string buffers
- `collections`: numeric lists and queues, statically named typed maps
- `errors`: typed construction, propagation, matching, and unwinding
- `system`: OS, architecture, CPU count, current directory, environment lookup
- `process`: synchronous exact-argument execution and explicit shell execution
- `regex`: compile-time portable byte patterns, search, and capture groups

This is the 0.1.1 API contract, not a promise to reproduce every API found in
other language ecosystems. For example, the portable regex grammar deliberately
rejects unsupported syntax at compile time, and IO deliberately defines UTF-8
text plus byte-exact buffers rather than host-dependent encoding behavior.

## Excluded Work

Only these unfinished library families are excluded from 0.1.1:

- `physics`, including the old `rigid_body` compatibility name
- `ui`, including `screen` and `events`
- `symbolic`

Importing one of them is a hard compiler error. No older implementation is
silently activated. They will enter a later release only after their whole
public surface is native and verified.

## Command Contract

```text
vkf program.vkf                 build if changed, then run
vkf program.vkf -o app         build named artifact if changed, then run
vkf -b program.vkf             build only beside source
vkf -b program.vkf -o app      build only with explicit output name
vkf -e ':: 2 + 2'              evaluate source text
vkf -t tests.vkf               run native tests in a file or directory
```

The compiler fingerprints source, transitive VKF modules, target, and compiler
build. An unchanged requested artifact runs without recompilation.

## Release Proof

Every platform job must:

1. build the strict native compiler;
2. run `vkf -t tests/vkf` with 279 passes and zero failures;
3. compile all 59 generated README examples 100 times from fresh source paths;
4. execute every generated README example in 100 fresh operating-system processes;
5. require byte-identical stdout/stderr and the same exit code across all 100 runs;
6. record every timing sample plus exact output, source hash, compiler hash, and host conditions;
7. run the 20-million-operation container stress example, calibrated near 100 ms after warmup;
8. compile and run the math, stat, random, and time source-surface tests;
9. run native IO, collections, errors, system, process, and regex smokes;
10. reject an excluded module;
11. build the archive and platform installer;
12. publish checksums and the exact per-example JSON/Markdown proof with every artifact.

The tagged `v0.1.1` workflow publishes all three platform results into one
GitHub release only after every job succeeds.

## Dependency Boundary

The installed product requires only operating-system facilities already used
by ordinary native programs. Python and developer compilers may be used to
orchestrate repository tests or build the compiler from source; they are not
shipped runtime dependencies and are never used to compile a user's VKF file.
