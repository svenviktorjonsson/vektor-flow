# Optimizer Policy Landscape

VKF's adaptive optimizer represents legal lowering choices as policy data. This
laboratory exhaustively measures those choices for a fixed program, verifies
every result, and records both distinct machine-code hashes and timing
dispersion.

The latest committed experiment is the
[VKF 0.1.5 Windows x64 spectral-norm landscape](evidence/windows-x64-v0.1.5.md).
It includes the complete 256-policy chart, exact conditions, all candidate
records, and an explicit warning that a small measured winner is not the same
as a statistically stable winner.

Run it from the repository root:

```powershell
node benchmarks/policy-landscape/run.mjs `
  --compiler=build/native-compiler-clang/bin/vkf-strict.exe `
  --runs=200 `
  --output=benchmarks/policy-landscape/evidence/windows-x64-v0.1.5
```

This is benchmark infrastructure. It is not a dependency of the compiler or
of compiled VKF programs.
