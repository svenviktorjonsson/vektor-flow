# QOPT-03: private driver proof adapter

Date: 2026-09-04

## Packet

- Lane: private automatic/quantum optimization proof.
- Base: `99f0f5dd083ac06285c2a5f6a2cc2506b307d47a` (QOPT-02).
- Branch: `codex/quantum/qopt03-driver-proof-adapter`.
- Worktree: `.worktrees/quantum/qopt03-driver-proof-adapter`.
- Consumed contracts: QOPT-01 schedule and QOPT-02 atomic proof cache.
- Public VKF syntax, semantics, APIs, diagnostics, schemas, and ABIs:
  unchanged.
- The existing diagnostic manifest shape is unchanged. Build receipts added by
  this packet are private in-memory compiler data.
- Explicit `tune` remains the opt-in 256-policy research landscape. Only
  one-shot `auto` compilation changes.

Owned paths:

- `compiler/native/vkf_retained_optimization_driver.hpp`
- `compiler/native/vkf_retained_optimization_driver_test.cpp`
- `compiler/native/vkf_retained_optimization_driver_integration_test.cpp`
- `compiler/native/vkf_x64_artifact.cpp`
- `compiler/native/CMakeLists.txt`
- `docs/evidence/qopt03-private-driver-proof-adapter.md`

## Observable private behavior

The adapter derives four domain-separated SHA-256 identities:

- program: canonical typed IR plus the driver's existing source-graph
  fingerprint, both length framed;
- function: the complete lowered entry closure plus its string data, both
  length framed;
- host: OS, architecture, object format, calling convention, x64 features,
  logical-core count, host name, CPU vendor, family/model/stepping, and feature
  bits; and
- toolchain: compiler kind and full version where available, C++ mode, private
  emitter revision, and compiler-build timestamp.

The private `BuildReceipt` retains all four fingerprints, QOPT-02's exact cache
reason, QOPT-01's schedule and selection reason, and an explicit proof-store
reason when persistence is attempted. Printable examples exercised here are
`missing`, `program-hit`, `function-hit`, `function-mismatch`, `host-mismatch`,
`toolchain-mismatch`, `incorrect-output`, `measurement-rejected`, `stored`,
`io-error`, and `not-attempted`.

On an `auto` cache hit, the native x64 backend reconstructs only the proven
policy and performs no benchmark. On a miss or explicit rejection, it emits
exactly `mask-0` and one guided `mask-ff` candidate. It alternates paired run
order, compares every returned `f64` bit-for-bit, caps evidence at the QOPT-02
4,096-pair limit, and feeds the complete paired evidence through QOPT-01's
one-sided 95% proof before selection. A parity mismatch blocks compilation
with no selected policy. A slower or statistically unproven candidate retains
`mask-0` explicitly. A proven candidate may serve the current build if atomic
persistence fails, but the receipt exposes `io-error`; it does not silently
substitute another policy.

The driver's existing `optimizer_cache_hit` bit now means a valid QOPT-02
program or function proof was loaded. The old best-effort JSON policy cache is
not consulted by `auto` and is written only by explicit research `tune`.

## Vertical TDD receipt

All focused commands used:

```text
clang++ -std=c++17 -O2 -Wall -Wextra -Werror -pedantic -I. compiler/native/vkf_retained_optimization_driver_test.cpp -o .work/qopt03/vkf_retained_optimization_driver_test.exe
```

1. Identity/miss tracer RED exited 1 in 1,546.8 ms because
   `vkf_retained_optimization_driver.hpp` did not exist. GREEN reported
   `cache=missing candidates=2`.
2. Proof-completion RED exited 1 in 3,826.6 ms because `complete` did not exist.
   GREEN stored a proven measurement and reused it as `program-hit` without
   another benchmark.
3. Parity-reason RED exited 1 in 6,105.7 ms because the private selection
   reason was not printable. GREEN returned `incorrect-output`, no selected
   policy, no store, and no fallback.
4. Reuse/rejection-reason RED exited 1 in 4,687.0 ms because receipt helpers
   did not exist. GREEN distinguished unchanged-function reuse from function,
   host, and toolchain changes while every miss still scheduled two policies.
5. Persistence-reason RED exited 1 in 4,260.3 ms because store status was not
   exposed. GREEN distinguished `not-attempted` from `io-error` and explicitly
   retained baseline for a measured slower candidate.

Final focused output:

```text
retained optimization driver: cache=missing candidates=2 retained=program-hit parity=incorrect-output changed=function-mismatch slower=measurement-rejected store=io-error
```

The corrected real-backend integration test was also compiled against the
untouched QOPT-02 parent source. That clean behavioral RED exited 1 in
140,166.8 ms with:

```text
real auto compilation must measure only baseline and one guided candidate
real auto compilation must report baseline before the guided candidate
retained optimization driver integration: candidates=256 exact_output=1
```

The same test against QOPT-03 passed with:

```text
retained optimization driver integration: candidates=2 exact_output=1
```

Its final strict Clang compile/run took 151,661.3 ms. The backend translation
unit has pre-existing missing-field, constructor-order, and unused-code
warnings, so this command kept `-Werror` while suppressing only those known
baseline warning classes:

```text
-Wno-missing-field-initializers
-Wno-reorder-ctor
-Wno-unused-parameter
-Wno-unused-variable
-Wno-unused-function
```

The adapter, cache, schedule, and proof tests compile with unsuppressed
`-Wall -Wextra -Werror -pedantic`.

## Native verification

Environment:

```text
Microsoft Windows 10.0.26200, X64
Clang 22.1.4 (llvm-project 35990504507d79e0b9deb809c8ee5e1b34ceef20)
MSVC 19.29.30159.0
CMake 4.3.0
```

Strict Clang passed 4/4 focused tests in 36,829.9 ms:

```text
vkf_retained_optimization_schedule_test
vkf_retained_optimization_cache_test
vkf_retained_optimization_driver_test
vkf_adaptive_optimizer_contract_test
```

The separate strict real-backend integration compiled and ran an actual PE
artifact, observed two candidates in the existing tuning receipt, and received
the exact expected `42` output.

From the verified short build path `C:\w\qopt03`, MSVC Release built:

```text
vkf_retained_optimization_driver_test
vkf_retained_optimization_driver_integration_test
vkf_retained_optimization_schedule_test
vkf_retained_optimization_cache_test
vkf_adaptive_optimizer_contract_test
vkf_x64_artifact
```

All five test executables passed in 870.7 ms after the final rebuild. The
standalone production `vkf_x64_artifact` compiled and linked. No test was
retried and no optimization fallback was used.

The structural work check is the measured candidate-count reduction from 256
to 2 on the identical real artifact tracer. It proves eliminated exploration,
not a wall-clock performance frontier; compiler/link time dominates these
commands. No speedup claim is made without independent T4 measurement.

SHA-256 at final GREEN:

| Artifact | SHA-256 |
| --- | --- |
| private driver adapter | `590EFFF57E6E85B5AAD50481311C588F6648494ED5389B28CDF3B1132D1BB1C1` |
| adapter behavior test | `3E6A93AB37E2C1B7089CBBD558270EB1C628C1575B29B8B911A9BD67D3F275BE` |
| real-backend integration test | `083DFDE0D65374129121B6C7C94416AA8BDF142B370A30977EFDF31F2810E167` |
| x64 backend source | `0169F3333BF923EAC0AFB5AB431472142D58B0DC388F8FE7BD770B8B43C3D6C9` |
| native CMake graph | `6BADF840EF706792C5C651C5BC4824A7735C19BABE16F60E9A19C244F7F0EC89` |
| strict Clang adapter test | `9F702F78853AB35DC318B6A1BA25E02F3C4E67011D7052EC64DEC1E93EBBAA99` |
| strict Clang integration | `686F0E4BB0868E94ED76CE15D315018C801D5A2FB6D88B937920D7FDACB01E6A` |
| MSVC adapter test | `DFDC414196DD03BE6D86F07088076715C4003C768FF2072B2339D8A23BB13EA6` |
| MSVC integration | `776BC3FD9725610B0D57559DB62FC3721E1D9E3DE0E3100D5368B9FE89663D25` |
| MSVC production x64 artifact | `52F90BCE4A2AE5D23BBB6E2B63F90AF2D01934F81E9B8F285E45F2C19E3E8A05` |

## Limitations and next gates

- The safe function identity is currently the complete entry closure. It
  permits reuse when unrelated typed-program material changes without changing
  lowered code, but does not yet retain independent decisions for several
  separately emitted functions.
- Toolchain identity intentionally includes build time. This is conservative:
  equivalent compiler rebuilds remeasure instead of risking stale codegen
  proof.
- Explicit research `tune` still explores the full landscape by request.
- Concurrent-process cache stress, admission/pruning, ownership, permissions,
  and stronger crash-durability policy remain QOPT-02 follow-ups.
- Production automatic CPU-pair selection still predates these proof receipts.
  GPU, stable reductions, cancellation, failure propagation, and deterministic
  multi-function scheduling remain unintegrated.
- Independent parent/release T4 evidence under ADR 0010 is still absent.

The next smallest gate is a per-function native emission adapter: retain one
receipt per separately emitted function, compose only compatible proven
policies, and keep dependency-linked functions serial unless the existing
analysis proves independence.

## Lane estimate

The quantum optimization lane is estimated at **83% complete**, with medium
confidence (about +/-7 points). Using the same 100-point weighting as QOPT-01
and QOPT-02: audit/model 10/10, statistical proof and parity 20/20, bounded
one-shot exploration 15/15, retained reuse 14/15, dependency-safe parallel
execution 8/15, explicit failure reporting 10/10, and shipped integration plus
independent performance evidence 6/15.

No Language Design Authority decision is required. This packet is independently
revertible and is not merged or pushed.
