# Lazy data comparison tracer

This is a correctness-first, non-gating harness for one future VKF, Vaex, and
Dask comparison. It does not contain measured performance results and does not
time VKF's private CSV scanner.

The workload reads one deterministic wide CSV and observes:

```text
sum((2*x-y)^2)
```

Only `x` and `y` contribute to the result. Six additional numeric columns make
unnecessary eager column materialization observable in later memory evidence.
The generator writes rows in bounded chunks. Its oracle is accumulated
separately with `BigInt` and is required to remain in the exact f64 integer
range. Fixture, contract, and VKF source hashes are recorded before any future
sample can be accepted.

## Current tracer

Verify the harness:

```sh
node --test benchmarks/lazy-data-comparison/run.test.mjs
```

Create the tiny fixture and a readiness receipt:

```sh
node benchmarks/lazy-data-comparison/run.mjs \
  --fixture=benchmarks/lazy-data-comparison/.work/fixture.csv \
  --rows=4096 \
  --output=benchmarks/lazy-data-comparison/.work/readiness.json \
  --revision=<git-commit>
```

Without explicit peer runners the receipt reports VKF, Vaex, and Dask as
`UNAVAILABLE`, retains empty raw-sample and comparison arrays, and makes no
timing claim. A missing peer is never replaced with pandas, NumPy, the private
VKF scanner, or another implementation.

Public executable CSV-backed `data.load`, a compatible Vaex runner, and a
compatible Dask runner are prerequisites for measurement. This environment has
not verified a mutually compatible Vaex/Dask/Python dependency set, so this
packet deliberately contains no `requirements.txt`. Versions must be pinned
only after both runners pass the same tiny-fixture oracle; until then the
contract marks the Relevant Peer Set as `unfrozen_dependencies`.
Readiness derives peer names from that versioned contract rather than a fixed
code list, so later peer-set reviews do not require fallback logic.

## Frozen boundaries

[`contract.json`](contract.json) defines separate fresh-source and warm-source
end-to-end rows. Both use a fresh process per sample and include runtime
startup, source binding, expression construction, scalar materialization, and
teardown. Fresh-source samples receive an empty engine-derived cache directory;
warm-source samples retain the engine cache after one excluded preparation
pass. OS cache state is uncontrolled and must be reported, so neither row may
be described as disk-cold evidence.

Fixture generation, compiler build, and dependency installation are outside
both timed regions. Future sampling must rotate VKF/Vaex/Dask order on the same
host, retain every raw sample and timeout, verify the exact scalar first, and
record all required provenance fields. Peak RSS remains explicitly unavailable
until a cross-platform process-memory probe is independently validated.

The ADR 0010 relative goal starts as an aspiration. This row cannot become a
release gate until it has passed three primary-runner cycles and one independent
runner cycle.
