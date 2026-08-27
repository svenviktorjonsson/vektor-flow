# Linear-algebra benchmark comparison

This suite compares VKF `.linalg` against three high-performance libraries
hosted by general-purpose programming languages:

- C++: [Eigen 5.0.0](https://libeigen.gitlab.io/)
- Rust: [faer 0.24.4](https://docs.rs/faer/0.24.4/faer/)
- Python: [SciPy 1.16.3 `scipy.linalg`](https://docs.scipy.org/doc/scipy/tutorial/linalg.html),
  using its recorded optimized BLAS/LAPACK backend

No universal ranking can identify three objectively “best” libraries for every
matrix shape and machine. These are strong practical baselines because each has
a mature dense solve, least-squares, eigen, LU, QR, Cholesky, and SVD surface.
Eigen publishes dense-decomposition performance guidance, faer explicitly
targets high-performance medium/large decompositions, and SciPy exposes
optimized BLAS/LAPACK through idiomatic Python APIs.

## Kernels

| Kernel | Fixture | Timed operation | Accuracy proof |
| --- | --- | --- | --- |
| `solve-general-96` | well-conditioned nonsymmetric 96×96 | factor + solve | backward residual + known-solution error |
| `least-squares-tall-96x48` | full-rank 96×48 | pivoted QR least-squares | normal residual + known-solution error |
| `lu-general-96` | nonsymmetric 96×96 | partial-pivot LU | reconstruction |
| `qr-tall-96x48` | full-rank 96×48 | economic QR | reconstruction + orthogonality |
| `cholesky-spd-96` | SPD 96×96 | lower Cholesky | reconstruction |
| `svd-tall-96x48` | full-rank 96×48 | thin SVD | reconstruction + left/right orthogonality |
| `eigen-symmetric-96` | SPD 96×96 | eigenvalues + eigenvectors | residual + reconstruction + orthogonality |

Raw eigenvectors are never compared between libraries: sign, phase, ordering,
and repeated eigenspaces are not unique.

## Latest verified result

The 0.3.0 Windows x64 evidence is the
[`readable report`](results/windows-x64-030.md) plus its
[`raw JSON`](results/windows-x64-030.json). The checked-in pre-release report
contains 30 rotating, single-thread samples per implementation; the JSON stores
every raw sample and validation maximum. All numerical gates pass, and every
VKF/competitor ratio is strictly below `1.5×`. Release automation repeats the
same combined gate with 100 samples per implementation.

## Measurement contract

- Every implementation consumes identical checked-in little-endian f64 bytes.
- Fixture SHA-256 is checked before sampling and stored in reports.
- Fixture loading, input cloning, one warmup, validation, and process startup
  are outside internal operation timers.
- Solve timers include factorization and solve. Decomposition timers include
  factorization and requested factor construction.
- Every sample must pass scale-independent numerical accuracy limits before its
  time is accepted.
- One CPU thread is forced initially through library APIs and BLAS environment
  variables. Thread count and backend are recorded.
- Same-host process order rotates each round. Reports store every sample,
  mean, sample standard deviation, machine conditions, and `VKF / competitor`.
- The 0.3.0 release requires every ratio to be strictly below `1.5×`.

Fixtures are generated from one deterministic integer-mix source. The tall
least-squares residual is constructed as `[r; -r]` against `A = [G; G]`, making
`A^T r = 0` by construction instead of trusting one competitor as reference.

## Verify harness and fixtures

```sh
node --test benchmarks/linalg-comparison/run.test.mjs
node benchmarks/linalg-comparison/materialize-fixtures.mjs --check
```

## Install competitors

Python:

```sh
python -m venv .venv-linalg
.venv-linalg/bin/python -m pip install -r benchmarks/linalg-comparison/requirements.txt
```

Windows uses `.venv-linalg/Scripts/python.exe`.

Build Eigen runner:

```sh
cmake -S benchmarks/linalg-comparison/competitors/eigen \
  -B .work/linalg-eigen -DCMAKE_BUILD_TYPE=Release
cmake --build .work/linalg-eigen --config Release --parallel
```

Build faer runner:

```sh
cargo build --release \
  --manifest-path benchmarks/linalg-comparison/competitors/faer/Cargo.toml
```

## Run

Build the per-kernel VKF native runners, then run the comparison:

```sh
node benchmarks/linalg-comparison/build-vkf-runners.mjs
node benchmarks/linalg-comparison/run.mjs \
  --vkf-manifest=.work/linalg-vkf-runners/manifest.json \
  --eigen=/path/to/eigen_runner \
  --faer=/path/to/faer_runner \
  --python=.venv-linalg/bin/python \
  --threads=1 \
  --runs=100 \
  --relative-limit=1.5 \
  --output=benchmarks/linalg-comparison/results/local.json
```

Development subsets use `--kernels=solve-general-96,eigen-symmetric-96`,
`--languages=scipy,eigen`, and lower `--runs` values.

The default suite covers every implemented dense numeric decomposition and
solver family in the public `.linalg` API. General nonsymmetric eigenpairs are
not implemented by `.linalg` and therefore are not presented as a VKF result.
Every timed runner is native, uses the same byte-identical fixture, excludes
fixture loading/warmup/validation from its operation timer, and must pass the
listed numerical accuracy gates before its sample is accepted.
