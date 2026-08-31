# 050-I86 one-core versus four-core benchmark evidence

## Scope

- Base: `70be8ead7ca1b00fbe37ce4e23a3551a068e3770`
- RED: `330f03a1923de3fa603e2ba95b2f41fd1b1171ea`
- Initial implementation: `6d980afc3622b3c085154f9c80b5183c8141b1b6`
- Branch: `codex/0.5/050-i86-one-vs-four-cpu-benchmark`
- Owned paths:
  - `benchmarks/automatic-flow-cpu/`
  - `docs/evidence/050-i86-one-vs-four-cpu-benchmark.md`
  - `docs/evidence/artifacts/050-i86-one-vs-four-cpu-provisional.json`

The public benchmark compiles one identical, parallel-safe four-demand source
with `process.max_cores: 1` and `process.max_cores: 4`. Compilation and warm-up
are excluded. Five or more measured artifact runs are interleaved in alternating
order. Every run verifies the same source-order output before contributing a
sample. Printing remains after the join and is never included in the selected
pure demand group.

The report includes raw milliseconds, mean, sample standard deviation, median,
p95, minimum, maximum, and median/p95 speedups. The test requires at least a
250 ms one-core median and only a conservative 1.10x median speedup, leaving a
wide noise margin below the observed implementation result.

## TDD evidence

Focused command, with `VKF_AUTOMATIC_CPU_COMPILER` set to the fresh I85 strict
compiler and `VKF_TEST_WORK_ROOT` inside this worktree:

```powershell
node --test benchmarks/automatic-flow-cpu/run.test.mjs
```

- RED: 0 passed, 1 failed, 271.87 ms. The public runner module did not exist.
- GREEN: 1 passed, 0 failed, 21,091.32 ms. Five samples per configuration,
  exact output equality, selector decisions, descriptive statistics, and the
  conservative speedup gate all passed.
- Post-contract rerun: 1 passed, 0 failed, 17,514.33 ms after pinning the
  measurable-duration guard and provisional evidence label.

## Provisional implementation run

A seven-sample run is stored at
`artifacts/050-i86-one-vs-four-cpu-provisional.json`. It is deliberately marked
`implementation-provisional`: other repository work was active, so it is not
an independently graduated performance row.

- One core: `2029.804 ms` median, `2726.270 ms` mean,
  `1835.878 ms` sample SD, `6038.476 ms` p95.
- Four cores: `818.693 ms` median, `875.101 ms` mean,
  `304.252 ms` sample SD, `1379.040 ms` p95.
- Median speedup: `2.479x`.
- p95 ratio: `4.379x`.
- Correctness: identical output `[250000001,250000002,250000003,250000004]`.

The high one-core variance confirms that this run must not be promoted. The
raw samples are retained so an independent exclusive rerun can compare rather
than replace evidence selectively.

## Merge queue order

Apply only reviewed clean commits in this dependency order:

1. I83 loop-exit terminator from
   `codex/0.5/050-i83-loop-exit-terminator-kind`:
   `68d420e`, then `aa8a774`.
2. I84 clean recovery selection chain:
   `261fbec`, `b7ec12f`, then `251fe13`.
3. I85 four-worker execution chain:
   `462cc0c`, `67e30db`, `24766e3`, then `70be8ea`.
4. I86 benchmark chain:
   `330f03a`, `6d980af`, `7a3250c`, `5ebc212`, `9200174`, then this evidence
   commit.

Do not merge or reset `codex/0.5/050-i84-four-worker-performance`. Its original
worktree still contains preserved uncommitted changes. The clean I84 recovery
commits above contain the verified replacement.

## Contract hashes

- `run.mjs`:
  `8D89D96185333EC566AA501570FE60FFF53AC8BED64F9ABEC2BC1DA21B43DAE2`
- `run.test.mjs`:
  `E43C80EAEA8AC1ED17B43A410B1A1A2BEE864C4BC36A2E379E657AC28B61B0B9`
- benchmark `README.md`:
  `25D2A101924B4451ADB32482758E3F53ECE67A7720B36ABD445E6A5CBF561899`
- provisional raw result:
  `0A52AE6CC54EBD64C1D12768ED1A50860726C571C26CAD599D6C7D57677AC4F1`

## Acceptance-gate impact

This supplies a reproducible correctness-gated public benchmark for the first
automatic four-way artifact execution. It demonstrates useful separation on
the implementation host without claiming a release-grade performance result.
The next action is independent T4 rerun on an exclusive machine after the
I83-I86 queue is integrated.
