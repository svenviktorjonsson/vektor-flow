# Core benchmark findings

## Current 20,000-step acceptance proof

Run: 2026-08-19, 10 warmups followed by 100 measured runs. `±` is sample
standard deviation; confidence bounds are two-sided 95% mean intervals.
Every lane produced `21.017288693559877`. Both compiler summaries reported
`artifact_fallback:false` and `frontend_mode:integrated`.

| platform and lane | mean ± std ms | 95% CI ms | p95 ms |
| --- | ---: | ---: | ---: |
| Windows x64, exact `vkf --aot -e "code"`, compile + launch + output | 32.615 ± 10.541 | 30.549–34.681 | 62.063 |
| Windows x64, fresh source path to runnable PE | 39.647 ± 4.328 | 38.798–40.495 | 47.853 |
| Windows x64, generated machine-code entry | 0.296 ± 0.040 | 0.288–0.304 | 0.389 |
| Windows x64, fresh PE process + 20,000 steps | 6.910 ± 1.003 | 6.713–7.106 | 8.074 |
| Linux x64, exact `vkf --aot -e "code"`, compile + launch + output | 7.347 ± 1.693 | 7.015–7.679 | 10.625 |
| Linux x64, compiler process + source to runnable ELF | 4.042 ± 1.191 | 3.808–4.275 | 7.076 |
| Linux x64, generated machine-code entry | 0.924 ± 0.682 | 0.790–1.057 | 2.473 |
| Linux x64, fresh ELF process + 20,000 steps | 1.848 ± 0.359 | 1.777–1.918 | 2.702 |

Windows proof uses Intel Core Ultra 7 255U on Windows 10.0.26200. Linux proof
uses the current `vkf-x64-linux-bench:current` Ubuntu 24.04 image on the same
host. The compiler and generated runtime invoke no Python. Direct PE/ELF
writers invoke no per-program C/C++ compiler, assembler, or linker.

Reproduce Linux proof:

```powershell
docker build -f benchmarks/core-comparison/Dockerfile.x64-linux -t vkf-x64-linux-bench:current .
docker run --rm --entrypoint /bench/native-entry-timer vkf-x64-linux-bench:current /bench/.vkfbuild/scalar/x64-code.bin 10 100
docker run --rm vkf-x64-linux-bench:current
docker run --rm --entrypoint /bin/sh vkf-x64-linux-bench:current -c 'code="$(cat /bench/scalar.vkf)"; exec /bench/native-process-timer /build/bin/vkf 10 100 --aot -e "$code"'
docker run --rm --entrypoint /bench/native-process-timer vkf-x64-linux-bench:current /build/bin/vkf 10 100 --aot --source /bench/scalar.vkf
```

Windows fresh-path samples and environment are stored in
`results/latest.json`; exact-command and entry lanes use the checked-in native
timer sources. Exact `-e` reuses its content-addressed artifact path; the fresh
source lane uses a new path every run and includes artifact creation and host
security scanning.

## Fixed-container built-in reductions

Run: 2026-08-19 on Windows x64, 10 warmups and 100 measured runs. Workload
computes `sum + mean + count`; every 64-value lane returned `2176.5`.

| language | compile mean ± std ms | runtime mean ± std ms |
| --- | ---: | ---: |
| VKF direct | 45.638 ± 16.743 | 8.241 ± 2.069 |
| C `-O3 -march=native` | 241.994 ± 52.301 | 8.895 ± 4.502 |
| NumPy | 117.109 ± 34.753 | 221.024 ± 46.204 |
| Rust `-O target-cpu=native` | 343.247 ± 114.551 | 7.921 ± 0.855 |

VKF 6,400-value direct case returned `20492800.5`: compile
`512.575 ± 76.529 ms`, runtime process `7.535 ± 1.136 ms`. Compact local
reduction loops keep emitted algorithm size constant; literal construction and
the 37,363-byte source dominate compilation. Raw samples and 95% intervals are
stored in `results/builtin-reduction-windows.json` and
`results/builtin-reduction-large-windows.json`.

## Compiler-owned Windows x64 acceptance run

Run: 2026-08-19, Intel Core Ultra 7 255U, Windows x64. Ten warmups, then
100 measured runs.

| measurement | mean ± std ms |
| --- | ---: |
| fresh source path to runnable PE | 39.647 ± 4.328 |
| exact `vkf --aot -e "code"`, compile + launch + output | 32.615 ± 10.541 |
| emitted machine-code entry, 20,000 steps | 0.296 ± 0.040 |
| runnable PE fresh process, including startup and output | 6.910 ± 1.003 |

The PE is constructed directly: DOS/COFF/PE headers, sections,
import descriptors, lookup tables, and IAT. It imports `printf` plus the direct math runtime from
`msvcrt.dll` and `ExitProcess` from `kernel32.dll`. No prelinked executable is
copied and no per-program compiler, assembler, or linker runs. The compiler's
lexer, parser, and typed-IR lowerer now run in-process; removing three frontend
process launches reduced source-to-PE mean from the earlier 185 ms range.

## Compiler-owned Linux x64 acceptance run

Run: 2026-08-19, Ubuntu 24.04 container on Intel Core Ultra 7 255U. Ten
warmups, then 100 measured runs.

| measurement | mean ± std ms |
| --- | ---: |
| `vkf --aot -e "code"`, source through native execution | 7.347 ± 1.693 |
| compiler process + source to runnable ELF | 4.042 ± 1.191 |
| emitted machine-code entry, 20,000 steps | 0.924 ± 0.682 |
| runnable ELF fresh process, including loader/startup | 1.848 ± 0.359 |

The ELF is now constructed by the VKF compiler itself: ELF/program
headers, interpreter contract, dynamic table, symbol/hash tables, GOT, and
`R_X86_64_GLOB_DAT` relocations. Per-program compilation invokes no C/C++
compiler, assembler, or linker and copies no prelinked executable template.
The artifact imports only `snprintf` and the direct math runtime (`pow`, `fmod`, `floor`,
`sqrt`, `sin`, `cos`, `exp`), writes output directly, and
produced `21.017288693559877`.

The machine-entry lane measures program execution without OS process creation,
dynamic-loader startup, or output formatting, matching ADR 0005's execution
budget. Fresh-process time remains reported separately.

## Direct Linux x64 acceptance run

Run: 2026-08-19, Ubuntu 24.04 container on Intel Core Ultra 7 255U. Ten
warmups, then 100 measured fresh processes.

| measurement | mean ± std ms |
| --- | ---: |
| source file to runnable ELF | 36.820 ± 9.394 |
| `vkf --aot -e "code"` compile + run + capture output | 25.849 ± 6.116 |
| emitted scalar-control ELF fresh launch + 20,000 steps | 2.677 ± 1.163 |

This is the earlier prelinked-template baseline. The stripped runner template was
statically linked once during Stage 0 construction.
Measured VKF compilations copy and patch that template directly; they do not
invoke C++, an assembler, or a linker. The eval command produced
`21.017288693559877`, used direct x64 with no fallback, and includes process
startup, compilation, execution, and output capture.

The Stage 0 compiler build is outside these per-program measurements. Removing
that remaining bootstrap dependency is tracked separately by ADR 0005.

Run: 2026-08-19, Intel Core Ultra 7 255U, Windows x64. Each reported value
uses 100 measured runs after warmup. `results/latest.*` contains the most recent
selected lane; the commands in `README.md` reproduce any lane or the full table.
The C/Python/Rust startup rows below come from the same-machine comparison run
immediately before the direct-x64 VKF reruns.

## Python-free compiler latency

| toolchain | empty-program compile, mean ± std ms |
| --- | ---: |
| VKF direct x64 compiler | 187.335 ± 34.598 |
| C / Clang O3 | 201.990 ± 23.919 |
| efficient Python / bytecode | 110.222 ± 10.032 |
| Rust optimized | 287.961 ± 66.284 |

VKF meets the 200 ms mean target. Its measured path is source through the native
lexer, parser, typed-IR lowerer, direct x64 emitter, and complete runnable PE.
It invokes neither Python nor a per-program C++ compiler. Each sample uses a
fresh source/build path; compiler-tool construction is outside measurement.
The non-empty scalar/branch/loop lane also passes at **185.574 ± 61.405 ms**
over 100 fresh source-to-PE builds.

Python bytecode generation is not an AOT/native compile, so its number is not
directly equivalent. It remains here only as an independent competitor.

## Empty-program runtime

| runtime | mean ± std ms |
| --- | ---: |
| VKF direct x64 executable | 48.508 ± 4.909 |
| C | 27.110 ± 3.684 |
| efficient Python with package imports | 993.371 ± 67.042 |
| Rust | 27.047 ± 3.860 |

VKF startup is a native process running emitted x64 code. Kernel results still
need separate operation/size rows; startup alone proves only artifact/runtime
shape.

## Core strengths

- Python-free compile and runtime Interface.
- Small fresh compile is below the 200 ms mean budget.
- Typed IR is validated at compile time and lowered to x64 machine code.
- Static shapes, records, functions, and fixed vectors have one native semantic
  center rather than a Python fallback.

## Core weaknesses

- Native lexer, parser, typed-IR lowering, MIR lowering, and artifact writing now
  share one compiler process on the default direct path.
- Direct x64 lowering currently covers the scalar numeric core. Unsupported IR
  uses the honest but slower C++/Clang native fallback.
- Windows PE, Linux ELF, and macOS arm64 Mach-O now use compiler-owned writers.
  macOS execution proof and broad runtime/language coverage remain incomplete.
- The legacy Python CLI module still owns bootstrap-only diagnostics and should
  be deleted after those remaining commands move behind native Interfaces.

## Fixes found by benchmarking

- Added direct typed-IR-to-x64 lowering and a prelinked minimal PE runner.
- Kept lean C++/Clang AOT as a visible fallback for unsupported typed IR.
- Removed compile-time program evaluation; loops now execute only at runtime.
- Reduced the copied runner from 199 KiB to a minimal dynamically linked PE,
  removing enough fresh-executable scan/I/O cost to meet the 200 ms budget.
- Fresh compile samples use unique source/build paths.
- Added direct CMake/C++17 native compiler builds.

## Structural containers and typed errors: matched VKF/Rust lanes

Run: 2026-08-20, Intel Core Ultra 7 255U, Windows x64. One compile warmup,
five runtime warmups, then 100 compile and 100 runtime samples. Each language
receives the same 6,400 literal `f64` values, builds a dynamic heap container,
runs the same single-pass algorithm, and produces the same result. VKF required
direct lowering with fallback disabled. Python was not involved.

| workload | source | compile mean ± std ms | process runtime mean ± std ms | VKF raw entry mean ± std ms |
| --- | --- | ---: | ---: | ---: |
| Welford standard deviation, VKF | 50,616 bytes / 22 lines | 450.383 ± 74.652 | 17.264 ± 4.154 | 0.822 ± 0.403 |
| Welford standard deviation, Rust | 50,767 bytes / 27 lines | 5865.453 ± 506.269 | 15.125 ± 2.322 | — |
| typed integer validation, VKF | 50,462 bytes / 19 lines | 459.356 ± 77.432 | 13.501 ± 2.530 | 0.485 ± 0.271 |
| typed integer validation, Rust | 50,656 bytes / 26 lines | 5950.186 ± 544.236 | 20.251 ± 5.899 | — |

Welford outputs matched within `1e-12`; validated sums both returned `6335`.
These compile results apply to deliberately source-heavy literal programs.
They show VKF's direct compiler is faster for these exact inputs, not that VKF
universally compiles faster than Rust. Rust Welford process runtime is slightly
lower; VKF validated-error runtime is lower. Raw VKF entry time excludes process
startup, so it is reported separately and is not compared against Rust process
time. Full samples and confidence intervals are in
`results/welford-large-windows-2026-08-20.json` and
`results/validated-sum-large-windows-2026-08-20.json`.

The benchmark exposed a Windows ABI error-path bug: generated code used
nonvolatile XMM7 as scratch storage. Typed validation corrupted the caller's
timer state and produced impossible timings. Error message state now uses
volatile XMM2; the 100-run raw timings above are the regression proof.

The matched small scalar regression lane remained byte-identical. Compile mean
moved from `73.848 ± 16.923 ms` to `75.645 ± 16.843 ms`; overlapping 95%
confidence intervals (`70.531–77.165` and `72.344–78.946 ms`) do not resolve a
real slowdown. Raw entry means likewise overlap and the machine-code SHA-256 is
identical.

## Welford literal and sqrt optimization

Run: 2026-08-20, same Windows x64 machine. One compile warmup, ten runtime
warmups, then 100 compile and 100 runtime samples. VKF and Rust compilation
finished before runtime measurement; process samples ran in rotating two-sample
batches to remove systematic first/second-language ordering bias.

| language | compile mean ± std ms | process runtime mean ± std ms |
| --- | ---: | ---: |
| VKF | 734.993 ± 33.858 | 15.969 ± 6.024 |
| Rust | 5924.653 ± 2566.916 | 17.727 ± 7.431 |

VKF now emits one literal-pool list initializer instead of 6,400 scalar MIR
pushes and uses target hardware sqrt. Its raw machine-entry time is
`0.226 ± 0.045 ms`, down from `0.822 ± 0.403 ms`. An immediate VKF-only
100-sample recheck measured compile at `326.325 ± 73.302 ms`; comparison against
the earlier baseline passes the no-regression gate for both compile and raw
runtime. The fair matched run has lower VKF means for both compile and process
runtime, but the process-runtime 95% confidence intervals overlap, so it is not
proof of universal runtime superiority.

Evidence:
`results/welford-large-interleaved-windows-2026-08-20.json` and
`results/welford-large-vkf-recheck-windows-2026-08-20.json`.

## Selective PE runtime imports

The Windows x64 writer now scans machine IR and imports only math functions the
program calls. Hardware `sqrt` needs no CRT import. On the same machine, a
100-run before/after VKF comparison reduced Welford fresh-process runtime from
`11.180 ± 4.361 ms` to `9.072 ± 1.234 ms`; compile moved from
`424.575 ± 58.113 ms` to `418.556 ± 60.884 ms`, and raw entry from
`0.336 ± 0.066 ms` to `0.264 ± 0.014 ms`.

A fresh matched 100-run VKF/Rust comparison measured VKF compile at
`419.511 ± 60.159 ms` versus Rust `3505.080 ± 603.535 ms`, process runtime at
`15.777 ± 6.378 ms` versus Rust `16.534 ± 5.830 ms`, and VKF raw entry at
`0.283 ± 0.020 ms`. The mean is lower in both matched columns; process-runtime
confidence intervals overlap, so the honest claim is lower measured mean, not
proved universal superiority.

Evidence:
`results/welford-selective-imports-windows-2026-08-20.json` and
`results/welford-selective-imports-vkf-rust-windows-2026-08-20.json`.
