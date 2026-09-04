# Performance, with the version attached

**VKF 0.3.0 · native Linux x64 · measured 28 August 2026.**

These are small, controlled comparisons—not a claim that VKF is faster at
everything. All languages ran on the same AMD EPYC 9V74 runner. Native results
do not predict browser/WASM performance or measure 0.4.1/0.5 development work.

## Runtime

The table is generated from the committed laboratory report. Times are raw
kernel means with sample standard deviation, excluding process launch:
1,000 measured runs after 50 warmups. Ratios are **VKF time / competitor time**;
**below 1 means VKF took less time**.

<!-- benchmark-summary -->

Spectral norm is an **idiomatic** comparison, allowing each implementation its
normal optimised route. Fannkuch and N-body are **matched-algorithm** comparisons.
VKF is slower than some competitors on these workloads; the ratios show that too.

## The cost of searching

The native compiler considers alternative execution policies and checks their
results. Its published compile times include a fresh policy search: roughly
300 ms for spectral norm, 110 ms for Fannkuch and 122 ms for N-body on this runner.
Faster execution can cost more compilation time.

[How policy search works](execution.md).

## Inspect the evidence

[Full timings, including compile and process time](../../benchmarks/core-comparison/results/linux-x64-030.md)
 · [Raw samples, environment and toolchain metadata](../../benchmarks/core-comparison/results/linux-x64-030.json)
 · [Methodology and reproduction](../../benchmarks/core-comparison/README.md).

The separate [linear-algebra](../../benchmarks/linalg-comparison/README.md) and
[symbolic-mathematics](../../benchmarks/symbolic-comparison/README.md) laboratories
cover their own workloads and competitors. They are not mixed into this table.
