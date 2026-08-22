# Performance benchmark policy

VKF performance claims use published benchmark algorithms, not project-invented
examples. Engineering regressions remain in the repository, but they are labeled
as regressions and are not presented as language comparisons.

## Comparative kernel set

The 0.1.4 single-process suite takes its initial kernels from the
[Computer Language Benchmarks Game](https://benchmarksgame-team.pages.debian.net/benchmarksgame/):

1. [spectral norm](https://benchmarksgame-team.pages.debian.net/benchmarksgame/description/spectralnorm.html):
   the specified power method for the infinite matrix;
2. [fannkuch-redux](https://benchmarksgame-team.pages.debian.net/benchmarksgame/description/fannkuchredux.html):
   the specified permutation order, alternating checksum, and maximum flip count;
3. [n-body](https://benchmarksgame-team.pages.debian.net/benchmarksgame/description/nbody.html):
   the specified Jovian constants and simple symplectic integrator.

The harness prints one finite validation number per process. Spectral norm prints
the norm. N-body prints final energy after momentum offset and integration.
Fannkuch combines its two integer validations as `checksum * 100 + maximum_flips`;
the permutation work is unchanged. This output adaptation makes the same strict
one-result validator usable for every language.

Every generated source is retained under `benchmarks/core-comparison/published`.
Reports record source hashes, compiler versions, flags, operating system, CPU,
sample count, means, standard deviations, medians, p95 values, and confidence
intervals. A run fails on wrong, missing, repeated, or unstable output.

## Scales and interpretation

The repository runs smaller fixed scales than the Benchmarks Game performance
server because release verification measures each program 100 times on three
operating systems. The algorithm and initialization stay fixed; the report shows
the exact scale.

Native implementations use their normal optimizing compiler. NumPy and Julia may
use optimized matrix operations for spectral norm. Sequential permutation and
five-body kernels use direct scalar implementations where vector-library setup
would add work rather than remove it. Therefore each row is labeled `matched` or
`idiomatic`; idiomatic rows compare the task, not identical instructions.

Process startup and compilation are reported separately from kernel execution.
VKF also reports raw generated-entry timing. Comparable raw native-kernel timing
for C, Rust, and Zig is required before the README claims a kernel-runtime win.

## Deliberate exclusions

[Binary trees](https://benchmarksgame-team.pages.debian.net/benchmarksgame/description/binarytrees.html)
is excluded until VKF can implement the required per-node allocation faithfully;
replacing allocation with arithmetic would invalidate the benchmark.

[STREAM](https://www.cs.virginia.edu/stream/) is excluded from short language
runtime tables. Standard STREAM requires arrays at least four times the aggregate
last-level cache size or one million elements, and it measures sustained memory
bandwidth rather than general language speed.

[PolyBench/C](https://www.cs.colostate.edu/~pouchet/software/polybench/polybench.html)
is reserved for a later loop-optimizer suite. It offers recognized kernels such
as GEMM and Jacobi, but must retain live-out data and dead-code-elimination guards.

VKF does not publish a translated subset as CoreMark. The
[official CoreMark rules](https://github.com/eembc/coremark) require unchanged
benchmark sources, validation seeds, and at least ten seconds of execution for a
reportable result.

## Engineering-only gates

`scalar-control-small` remains a VKF-only historical acceptance test: 20,000
iterations, mean compiler-core time below 10 ms, and mean raw entry time below
500 microseconds over 100 measured runs. It protects the compiler contract; it is
not evidence that VKF is faster than another language.
