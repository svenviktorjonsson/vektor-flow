# Automatic-flow CPU benchmark

This benchmark measures the first generated-artifact automatic-flow tracer. It
compiles the same four independent integer recurrences twice:

- `process.max_cores: 1` keeps all demands serial;
- `process.max_cores: 4` permits the compiler to select its private four-way
  CPU group.

Each lane performs 250,000,000 loop iterations by default, for one billion
logical iterations per artifact run. Compilation, warm-up, and correctness
checks are outside measured samples. Measured one-core and four-core runs are
interleaved in alternating order to reduce thermal and order bias.

Every run must produce the same four source-order values. Printing remains an
effect boundary after the pure demands have joined; output work is never part
of the parallel group.

The JSON report contains raw samples, mean, sample standard deviation, median,
p95, minimum, maximum, and median/p95 speedups. The integration test requires:

- at least five samples per configuration;
- a one-core median of at least 250 ms so timer/startup noise cannot dominate;
- exact output equality and the expected selection decisions; and
- a conservative median speedup of at least 1.10x.

Run on Windows with a freshly built strict compiler:

```powershell
node benchmarks/automatic-flow-cpu/run.mjs `
  --compiler build/native/bin/vkf-strict.exe `
  --samples 7 `
  --iterations 250000000 `
  --output build/automatic-flow-cpu.json
```

Runner output is implementation-provisional. A release performance claim
requires an independent rerun on an exclusive machine under the repository's
performance protocol.
