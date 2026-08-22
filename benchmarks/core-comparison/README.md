# Core language comparison

This suite remains useful for language-to-language research and narrow compiler
regressions. It is not the 0.1.1 release gate. Release acceptance now uses every
documented program, exact output, and full-process runtime through
[`benchmarks/readme-examples`](../readme-examples/README.md).

Compares equivalent core programs in Vektor Flow, C, efficient Python, and
Rust. Core built-in lanes include fixed-container `stat.sum`, `stat.mean`, and
`stat.count`; they exclude library implementation overhead outside each
language's normal optimized path.

Python uses the best suitable lane for each operation:

- scalar CPython for inherently sequential work
- vectorized NumPy with matrix-power algorithms for linear vector/record recurrences
- SciPy `signal.lfilter` for a linear recurrence

This keeps the comparison honest: Python gets its best practical numerical
algorithm, not an intentionally slow loop when vectorization is available.

The runner measures two separate costs:

- compile wall time: fresh output path for every sample
- runtime wall time: a new process for every sample after warmups
- VKF raw machine-entry runtime: generated code only, excluding process launch

For the legacy 20,000-operation `scalar-control-small` VKF regression case, a
full 100-sample run still enforces its own narrow limits: mean compile time must be strictly under 10 ms
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
node benchmarks/core-comparison/run.mjs --case=builtin-reduction-small --output=builtin-reduction-windows
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

Reproduce the four-language Linux comparison on container-local storage (a
Windows bind mount materially distorts file-creation timings):

```powershell
docker build -f benchmarks/core-comparison/Dockerfile.comparison-linux -t vkf-comparison-linux .
docker run --name vkf-core-proof vkf-comparison-linux node benchmarks/core-comparison/run.mjs --case=scalar-control-small,fixed-vector-medium,welford-large --language=vkf,c,cpp,rust --compile-runs=100 --compile-warmups=1 --runs=100 --warmups=5 --output=core-final-linux-100
docker cp vkf-core-proof:/repo/benchmarks/core-comparison/results/core-final-linux-100.json benchmarks/core-comparison/results/core-final-linux-100.json
docker cp vkf-core-proof:/repo/benchmarks/core-comparison/results/core-final-linux-100.md benchmarks/core-comparison/results/core-final-linux-100.md
docker rm vkf-core-proof
```

`native-entry-timer` isolates generated-program execution. `native-process-timer`
includes process startup and is used for source-to-execution and fresh-launch lanes.

Defaults are 100 measured compile samples, 100 process-runtime samples, and 100
raw VKF machine-entry samples.
Each operation has small, medium, and large workload rows. Results are written
to `results/latest.json`; the readable mean ± standard-deviation tables are in
`results/latest.md`. JSON also includes median, minimum, maximum, p95, and a 95%
confidence interval.

Required local tools:

- Node.js (benchmark harness only)
- current Python (`py` or `python`) with NumPy and SciPy for the Python lane only
- Clang for C and for building the native VKF compiler once before measurement
- Rust

The programs use the same constants, floating-point number model, loop shape,
and numeric output. Cross-language results must agree within each case's stated
tolerance or the run fails.

`welford-large` and `validated-sum-large` are matched VKF/Rust feature lanes.
Both receive the same 6,400 literal `f64` values, allocate a dynamic heap
container, execute the same single-pass algorithm, and print the same result.
Welford exercises open-record state, block expressions, and hardware `math.sqrt`;
validated sum exercises checked `int` conversion plus typed `ValueError`
selection. No answer is precomputed and no Python participates in either lane.

Every measured VKF compile uses a fresh source/build path. Compiler setup is
outside the measured region. Program evaluation is deferred to runtime, so
compile results cannot contain precomputed benchmark answers.

Normal direct AOT compilation keeps tokens, AST, typed IR, machine IR, code,
and data in memory and writes only the runnable artifact. `--diagnostics`
explicitly enables those JSON/binary sidecars for inspection and raw-entry
timing; omitting unrequested diagnostics is part of the normal compiler path,
not a benchmark-only shortcut.

Windows x64 proof on 2026-08-20, 100 matched runs of `welford-large`: VKF
compiled in **419.511 ± 60.159 ms** versus Rust **3505.080 ± 603.535 ms**;
fresh-process runtime was **15.777 ± 6.378 ms** versus Rust
**16.534 ± 5.830 ms**. VKF raw machine-entry runtime was
**0.283 ± 0.020 ms**. The runtime means favor VKF, but their 95% confidence
intervals overlap; this is not evidence of universal runtime superiority.

Interpretation limits:

- compile times are end-to-end toolchain times, not parser-only times
- runtime includes process startup; the empty-program row exposes that cost
- Python bytecode compilation is not equivalent to native code generation, so
  its compile time is reported but should not be read as an AOT comparison
- fixed vectors and records are value-oriented in all four programs, but each
  compiler remains free to optimize copies
- large literal payloads measure parsing and code generation of that payload;
  their compile figures do not generalize to compact-source programs
