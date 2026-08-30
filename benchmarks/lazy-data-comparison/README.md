# Lazy data comparison tracer

This is a correctness-first, non-gating harness for VKF, Polars, and future
Vaex/Dask comparisons. It does not contain measured performance results and
does not time VKF's private CSV scanner.

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

Provide the integrated public VKF compiler to verify the real VKF runner:

```sh
node benchmarks/lazy-data-comparison/run.mjs \
  --fixture=benchmarks/lazy-data-comparison/.work/fixture.csv \
  --rows=4096 \
  --output=benchmarks/lazy-data-comparison/.work/readiness.json \
  --revision=<git-commit> \
  --vkf-runner=<path-to-vkf>
```

The readiness step generates a source file from the checked-in VKF template,
compiles it through public `data.load`, executes the resulting artifact, and
requires the exact fixture oracle. Only then is VKF `AVAILABLE`. The receipt
records canonical source and runner hashes but no elapsed time or ratio.

Polars is the first verified external peer. Install its pinned dependency into
an ignored repository-local virtual environment, then pass that environment's
Python executable:

```sh
python -m venv .venv
.venv/bin/python -m pip install -r \
  benchmarks/lazy-data-comparison/requirements-polars.txt
node benchmarks/lazy-data-comparison/run.mjs \
  --fixture=benchmarks/lazy-data-comparison/.work/fixture.csv \
  --rows=4096 \
  --output=benchmarks/lazy-data-comparison/.work/readiness.json \
  --revision=<git-commit> \
  --polars-runner=.venv/bin/python
```

The checked-in peer runner uses Polars' public lazy `scan_csv`, projection,
expression reduction, and scalar collection APIs. Readiness requires the exact
fixture oracle and pinned Polars version, and records canonical hashes for the
runner source, Python executable, and installed Polars package contents. It
still records no samples, timings, or performance ratios.

Without explicit peer runners the receipt reports VKF, Polars, Vaex, and Dask as
`UNAVAILABLE`, retains empty raw-sample and comparison arrays, and makes no
timing claim. A missing peer is never replaced with pandas, NumPy, the private
VKF scanner, or another implementation.

Public executable CSV-backed `data.load`, a compatible Vaex runner, and a
compatible Dask runner are prerequisites for measurement. This environment has
not verified a mutually compatible Vaex/Dask/Python dependency set. Polars is
pinned independently because it passes the exact tiny-fixture oracle; the
remaining peer set stays `unfrozen_dependencies`.
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
both timed regions. Future sampling must rotate all available peers on the same
host, retain every raw sample and timeout, verify the exact scalar first, and
record all required provenance fields. Peak RSS remains explicitly unavailable
until a cross-platform process-memory probe is independently validated.

The ADR 0010 relative goal starts as an aspiration. This row cannot become a
release gate until it has passed three primary-runner cycles and one independent
runner cycle.
