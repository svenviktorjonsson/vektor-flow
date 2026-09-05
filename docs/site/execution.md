# Execution-policy search

**Describe the work; let the compiler investigate how to execute it.**

VKF treats some lowering choices as data. The native optimiser explores legal
variants, checks their results, removes duplicate machine code and retains a
policy for the particular program and host. Normal search has a time budget;
exhaustive search is a separate benchmark mode.

This can trade compilation time for runtime performance. Fresh policy-search
time is included in the published compile measurements, not hidden outside them.
A measured choice is evidence for that workload and machine, not proof of a
globally optimal implementation.

## Laziness and parallelism

The language's design direction is to make lazy data access and beneficial
parallel execution part of the execution model, without a separate array or
distributed-computing framework. Correct results and observable behaviour still
constrain which transformations are legal.

That principle is broader than the current verified implementation. Neither a
particular benchmark win nor a browser demo establishes automatic parallelism
or lazy loading throughout every library. Support must be stated for the
specific compiler version and target.

## What “Quantum” means here

Some development work uses the name “Quantum” for optimisation research.
**Execution-policy search** describes the relevant idea more directly. The
published results are classical CPU measurements, not quantum-computer results.

[Inspect the measured policy landscape](../../benchmarks/policy-landscape/evidence/windows-x64-v0.3.0-ci.md),
or return to the [versioned performance summary](performance.md).
