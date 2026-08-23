# Core language comparison

This suite provides narrow language-to-language evidence and compiler
regression checks. It is not the only 0.1.5 release gate. Release acceptance also uses every
documented program, exact output, and full-process runtime through
[`benchmarks/readme-examples`](../readme-examples/README.md).

Published comparison rows cover Vektor Flow, C, Rust, Zig, Go, Julia, and
efficient Python. C++ remains available in the research runner but is omitted
from the landing-page table. Exact published sources live under
[`published`](published); the runner records both source and template SHA-256.

Every case declares one of two comparison modes:

- **matched**: same algorithm and constants in every language;
- **idiomatic**: same result-producing task, but each ecosystem may use its
  normal optimized implementation.

The published 0.1.5 kernel set is deliberately recognizable:

- spectral norm by the power method;
- fannkuch-redux permutation flipping;
- five-body symplectic integration.

These are adapted from the Computer Language Benchmarks Game. Exact provenance,
adaptation rules, exclusions, and links to primary sources are in
[`docs/performance-benchmarks.md`](../../docs/performance-benchmarks.md). Python
uses NumPy for spectral norm and direct sequential code where dependencies
cannot remove the permutation or time-step dependency. Competitors are never
forced through intentionally slow APIs.

The runner keeps four costs separate:

- fresh-process compile wall time: tool startup, fresh source/output path, and compilation
- VKF internal compiler-core time: persistent compiler, fresh source/output path, no process startup
- runtime wall time: a new process for every sample after warmups
- raw kernel runtime: generated code only, excluding process launch, for VKF,
  C, Rust, and Zig

The landing page has one performance table. It shows VKF's raw-kernel mean ±
sample standard deviation and the same-report `VKF mean / competitor mean`
ratio for C, Rust, and Zig. Every one of the nine ratios must be strictly below
`2×`; no aggregate score can hide a failed kernel. Compile and process-runtime
measurements remain in the JSON/Markdown laboratory report, not the landing
table.

For the legacy 20,000-operation `scalar-control-small` VKF regression case, a
full 100-sample run still enforces its own narrow limits: mean internal compiler-core time must be strictly under 10 ms
and mean raw machine-entry runtime must be strictly under 0.5 ms (500
microseconds). Reaching either limit fails this comparison run. Process-launch time is
reported but is not substituted for the raw-entry metric.

All native languages compile before process-runtime measurement. Runtime samples
then run in rotating two-sample language batches, preventing the language measured
second from inheriting a systematically different OS/cache/Defender state.

It also keeps the user-visible latency gate separate: `vkf --aot -e "code"`
must compile to a native executable, run it, and print its output in under
103 ms mean across 100 runs. Both process startups and output capture count.

An empty-program startup lane is measured for every runtime. Reports include a
startup-adjusted mean (`runtime mean - matching empty runtime mean`) beside raw
mean and median. Treat small adjusted values as noise, not sub-millisecond proof.

VKF compilation uses the native lexer, parser, typed-IR lowerer, and direct x64
artifact compiler. The measured output is a runnable executable containing the
program's machine code. Every benchmark case requires direct lowering and fails
on fallback. Neither VKF compilation nor VKF runtime invokes Python; Python is
measured only as an independent competitor.

Run:

```powershell
node benchmarks/core-comparison/run.mjs
node benchmarks/core-comparison/run.mjs --compile-runs=10 --runs=30 --warmups=5
node benchmarks/core-comparison/run.mjs --case=startup
node benchmarks/core-comparison/run.mjs --case=startup --language=vkf
node benchmarks/core-comparison/run.mjs --case=spectral-norm-medium --output=spectral-norm-windows
node benchmarks/core-comparison/compare-regression.mjs --before=benchmarks/core-comparison/results/previous.json --after=benchmarks/core-comparison/results/latest.json
```

Every direct-language slice must compare 100-run before/after results on the
same platform, architecture, and CPU. Compile and raw machine-entry means may
not increase. Identical generated-code hashes prove that a raw-runtime mean
increase is measurement noise; any other increase fails unless the comparison
records an explicit `--reason` explaining why the cost is unavoidable.

Reproduce the strict direct Linux x64 acceptance lane:

```powershell
docker build -f benchmarks/core-comparison/Dockerfile.x64-linux -t vkf-x64-linux-bench .
docker run --rm vkf-x64-linux-bench
docker run --rm --entrypoint /bench/native-entry-timer vkf-x64-linux-bench /bench/.vkfbuild/scalar/x64-code.bin 10 100
docker run --rm --entrypoint /bench/native-process-timer vkf-x64-linux-bench /build/bin/vkf 10 100 --aot --source /bench/scalar.vkf --run
docker run --rm --entrypoint /bin/sh vkf-x64-linux-bench -c 'code="$(cat /bench/scalar.vkf)"; exec /bench/native-process-timer /build/bin/vkf 10 100 --aot -e "$code"'
```

GitHub Actions release job `comparison-linux-x64` installs pinned comparison
tools, verifies Zig's official SHA-256, then runs this exact command on
Linux-local storage:

```bash
node benchmarks/core-comparison/run.mjs --case=startup,scalar-control-small,spectral-norm-medium,fannkuch-redux-medium,n-body-medium --language=vkf,c,rust,zig,go,julia,python-efficient --compile-runs=100 --compile-warmups=1 --runs=100 --warmups=5 --output=linux-x64-015
```

Run the current strict three-kernel goal locally in one pinned Ubuntu 24.04
container (including checksum-verified Zig 0.16.0):

```powershell
docker build -f benchmarks/core-comparison/Dockerfile.comparison-linux -t vkf-comparison-linux-goal .
docker run --rm vkf-comparison-linux-goal
```

The container command uses 100 raw runs after 10 warmups for each of VKF, C,
Rust, and Zig. The runner exits nonzero if any same-host ratio reaches `2×`.

`native-entry-timer` isolates generated-program execution. `native-process-timer`
includes process startup and is used for source-to-execution and fresh-launch lanes.

Defaults are 100 measured compile samples, 100 process-runtime samples, and 100
raw kernel samples where supported.
Each operation has small, medium, and large workload rows. Results are written
to `results/latest.json`; the readable mean ± standard-deviation tables are in
`results/latest.md`. JSON also includes median, minimum, maximum, p95, and a 95%
confidence interval.

Required local tools:

- Node.js (benchmark harness only)
- Python 3.14 with pinned NumPy/SciPy from `requirements.txt`, for the competitor lane only
- Clang for C and for building the native VKF compiler once before measurement
- Rust 1.98.0, Zig 0.16.0, Go 1.26.5, and Julia 1.12.7

Programs use the same constants and checked numeric result. Matched cases also
use the same loop/algorithm shape. Idiomatic cases deliberately may not.
Cross-language results must agree within each case's stated tolerance or the
run fails.

Every measured VKF compile uses a fresh source/build path. Compiler setup is
outside the measured region. Program evaluation is deferred to runtime, so
compile results cannot contain precomputed benchmark answers.

Normal direct AOT compilation keeps tokens, AST, typed IR, machine IR, code,
and data in memory and writes only the runnable artifact. `--diagnostics`
explicitly enables those JSON/binary sidecars for inspection and raw-entry
timing; omitting unrequested diagnostics is part of the normal compiler path,
not a benchmark-only shortcut.

Interpretation limits:

- compile times are end-to-end toolchain times, not parser-only times
- runtime includes process startup; the empty-program row exposes that cost
- Python bytecode compilation is not equivalent to native code generation, so
  its compile time is reported but should not be read as an AOT comparison
- fixed vectors and records are value-oriented in native-loop programs, but each
  compiler remains free to optimize copies
- large literal payloads measure parsing and code generation of that payload;
  their compile figures do not generalize to compact-source programs
