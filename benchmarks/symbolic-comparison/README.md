# Symbolic benchmark comparison

This laboratory compares VKF's native symbolic engine with three symbolic
libraries hosted by general-purpose languages:

- SymEngine at commit `0c183629a35dd9d8123fafcc47b0e0283bbae80d` in C++
- SymPy `1.14.0` in Python
- Symbolics.jl `7.31.0` in Julia `1.12.6`

The four operations are the exact shapes published in SymEngine's benchmark
suite, not kernels invented for VKF:

| Kernel | Published operation | Validated result |
| --- | --- | ---: |
| `expand1` | expand `(x + y + z + w)^60` | 39,711 terms |
| `expand2` | expand `e * (e + w)`, where `e = (x + y + z + w)^15` | 6,272 terms |
| `add1` | accumulate 3,000 alternating powers of `x` | 2,998 nonconstant terms |
| `series` | multiply `[0, 1, ..., 999]` by itself, truncated to order 1,000 | coefficient 999 = 166,167,000 |

## Latest verified result

The 0.3.0 Linux x64 evidence is the
[`readable report`](results/linux-x64-030.md) plus its
[`raw JSON`](results/linux-x64-030.json). It contains all ten measured samples
per kernel and competitor from the same release workflow run.

Upstream sources: [expand1.cpp](https://github.com/symengine/symengine/blob/0c183629a35dd9d8123fafcc47b0e0283bbae80d/benchmarks/expand1.cpp), [expand2.cpp](https://github.com/symengine/symengine/blob/0c183629a35dd9d8123fafcc47b0e0283bbae80d/benchmarks/expand2.cpp), [add1.cpp](https://github.com/symengine/symengine/blob/0c183629a35dd9d8123fafcc47b0e0283bbae80d/benchmarks/add1.cpp), and [series.cpp](https://github.com/symengine/symengine/blob/0c183629a35dd9d8123fafcc47b0e0283bbae80d/benchmarks/series.cpp).

## Measurement contract

Each implementation constructs its inputs before starting its internal
monotonic timer. The timer covers only the symbolic operation. Every completed
sample must produce the validated result above. Each round rotates the process
order on the same host so one language does not systematically receive the
first or last CPU state.

The report stores every sample, source and executable hashes, exact tool
versions, host CPU and OS, timeout counts, means, sample standard deviations,
and `VKF / competitor` ratios. A ratio below `1` means VKF was faster. The
release gate passes `--relative-limit=1.5` and requires every ratio to be
strictly below that limit.

A timeout is censored evidence, not a measurement. If an operation exceeds the
configured timeout, the report uses that timeout only as a conservative lower
bound for competitor time and prints the ratio as `<x`. It never invents a
competitor mean or standard deviation.

## Pinned environments

Create a Python environment and install the exact requirement:

```sh
python -m venv .venv-symbolic
.venv-symbolic/bin/python -m pip install -r benchmarks/symbolic-comparison/requirements.txt
```

On Windows, the Python executable is `.venv-symbolic/Scripts/python.exe`.

Install Julia `1.12.6`, then instantiate the committed Project and Manifest:

```sh
julia --project=benchmarks/symbolic-comparison/julia \
  -e 'using Pkg; Pkg.instantiate()'
```

Build SymEngine from the pinned commit with Boost `1.86.0`. The checked-in
`cmake/BoostConfig.cmake` makes the header-only Boost multiprecision dependency
explicit even with recent CMake versions:

```sh
git clone https://github.com/symengine/symengine.git .work/symengine
git -C .work/symengine checkout 0c183629a35dd9d8123fafcc47b0e0283bbae80d
cmake -S .work/symengine -B .work/symengine-build \
  -DINTEGER_CLASS=boostmp -DBUILD_TESTS=OFF -DBUILD_BENCHMARKS=OFF \
  -DBoost_DIR="$PWD/benchmarks/symbolic-comparison/cmake" \
  -DBOOST_ROOT=/path/to/boost_1_86_0
cmake --build .work/symengine-build --config Release --parallel
cmake -S benchmarks/symbolic-comparison/competitors \
  -B .work/symengine-runner \
  -DSymEngine_DIR="$PWD/.work/symengine-build" \
  -DBoost_DIR="$PWD/benchmarks/symbolic-comparison/cmake" \
  -DBOOST_ROOT=/path/to/boost_1_86_0
cmake --build .work/symengine-runner --config Release --parallel
```

## Run

Pass the exact executables for the local environment:

```sh
node benchmarks/symbolic-comparison/run.mjs \
  --compiler=build/native-compiler-clang/bin/vkf-strict \
  --python=.venv-symbolic/bin/python \
  --julia=/path/to/julia \
  --symengine=.work/symengine-runner/symengine_runner \
  --runs=3 \
  --timeout-ms=30000 \
  --relative-limit=1.5 \
  --output=benchmarks/symbolic-comparison/results/local.json
```

Append `.exe` where required on Windows. `--julia-depot=/path` can isolate the
Julia package cache. `--kernels=series,add1` and
`--languages=vkf,symengine` provide quick development subsets. VKF uses the
compiler's `auto` policy by default; override it explicitly with
`--optimizer-policy=mask-ff` when studying a fixed policy.

The command exits nonzero if any completed or conservatively bounded
`VKF / competitor` ratio reaches `--relative-limit`, any output differs, or any
tool fails. The default and release limit is `1.5`; release verification also
passes it explicitly, and the value is recorded in the JSON and Markdown
evidence.

## Release verification

The native release workflow runs ten samples of the full four-kernel comparison on Linux only
after the Windows x64, Linux x64, and macOS arm64 compiler verification jobs
succeed. It installs the pinned SymPy and Symbolics.jl environments and builds
the pinned SymEngine revision with Boost 1.86.0, then uploads both evidence
files even when the relative gate fails. Publishing depends on this job.
