# QOPT-01: retained proof-gated optimization schedule

Date: 2026-09-04

## Packet

- Lane: private automatic/quantum optimization proof.
- Base: `16975b6ea1e9a0d62443a84890cc696cfe8b26c4`.
- Branch: `codex/quantum/qopt01-retained-proof`.
- Worktree: `.worktrees/quantum/qopt01-retained-proof`.
- Scope: private compiler scheduling contract, proof-aware CPU-pair overload,
  behavior tests, and native build registration.
- Public VKF syntax, semantics, API, diagnostics, schema, and ABI: unchanged.
- 0.5 integration-site, bootstrap source, UI, renderer, and packaging paths:
  unchanged.

Owned paths:

- `compiler/native/vkf_retained_optimization_schedule.hpp`
- `compiler/native/vkf_retained_optimization_schedule_test.cpp`
- `compiler/native/vkf_adaptive_optimizer.hpp`
- `compiler/native/vkf_adaptive_optimizer_contract_test.cpp`
- `compiler/native/CMakeLists.txt`
- `docs/evidence/qopt01-retained-optimization-proof.md`

## Baseline audit

The base already contained several useful but disconnected mechanisms:

- eight policy bits, hence 256 legal masks;
- deterministic per-function analysis fingerprints in the diagnostic manifest;
- a program-wide tuning fingerprint over compiler build, host features, and the
  complete typed IR;
- a program-wide profile cache retaining the exact tested policy;
- replay/partition safety that excludes nondeterminism, ordered effects,
  fallible functions, owned resources, and reductions without a stable tree;
- a structurally recognized two-call dependency shape and Windows CPU-pair
  execution; and
- a one-sided 95% paired-log-ratio proof gate requiring exact output parity.

The gaps were concrete. Ordinary fresh tuning could construct up to all 256
policies before timing. Any program fingerprint change invalidated the only
persisted policy even when most functions were unchanged. Function decisions
were reported but not retained. The CPU pair used an older static work
threshold, while the latest contract test already required measured proof.
Invalid optimizer profiles were treated as an unreported cache miss by the
driver.

The adopted base was itself RED. Strict Clang reported one aggregate
initializer warning promoted to an error and seven calls to the new
proof-aware CPU-pair shape without a matching implementation.

The committed 0.3.0 Windows x64 policy landscape remains useful audit evidence:

```text
policies:             256
correct policies:     256
distinct binaries:     36
timed runs:          7272
optimizer time: 96442.0908 ms
selected policy:   mask-c
selected mean:     2.26166 ms
default mean:      2.2780745 ms
reported gain:     0.7205427%
artifact fallback: false
```

The source fixture output was `1.2742238666431716` against expected
`1.2742238666431718`. The evidence JSON SHA-256 is
`ECCA8A7F9304F467A426E1755C9319B574360474BD71534B2E862C0D8FBFAFBA`.
This validates the historical landscape and parity harness; its small selected
gain is not reused as a new statistical authorization.

## Observable private behavior

For a deterministic function, the schedule consumes program and function
fingerprints, baseline and guided policies, a proof key, optional retained
evidence, and optional fresh evidence.

- An unchanged program and function reuse the retained candidate without a
  benchmark.
- An unchanged function can reuse its valid proof when unrelated surrounding
  code changes the program fingerprint.
- A changed one-shot function schedules exactly two policies: baseline and the
  guided candidate. It never requests the 256-policy research landscape.
- Fresh or retained evidence is reassessed against the complete proof key.
- The candidate is enabled only when output is equivalent and the one-sided
  95% upper confidence ratio is below one.
- Slower, noisy, invalid, or insufficient evidence explicitly retains the
  baseline with the proof rejection attached.
- Fresh or retained parity failure returns `Blocked` with no selected policy;
  it cannot become an implicit cache miss or silent baseline fallback.
- Nondeterministic functions explicitly remain baseline and are not replayed.

The proof-aware CPU-pair overload additionally requires an approved measured
decision, two replay-safe partition candidates, two available lanes, and an
affirmative dependency proof. It preserves the existing source-order result
tuple. An unproven, dependent, effectful, reduction, or one-lane pair remains
serial.

## TDD receipt

First RED:

```text
clang++ -std=c++17 -O2 -Wall -Wextra -Werror -pedantic -I. compiler/native/vkf_retained_optimization_schedule_test.cpp -o .work/qopt01/vkf_retained_optimization_schedule_test.exe
```

Exit 1 in 1182.0 ms because
`compiler/native/vkf_retained_optimization_schedule.hpp` did not exist.

First GREEN printed:

```text
retained optimization schedule: reused_program=1 reused_function=1 changed_candidates=2 faster_ratio=0.699927 parity_blocked=1
```

The adopted CPU-pair contract RED was then closed by the measured-proof
overload. A final mutation made retained parity evidence false. It compiled but
exited 1 with:

```text
a retained parity failure must block instead of becoming a cache miss
```

The minimal GREEN blocks that record and clears the selected policy.

Final strict command for both focused tests:

```text
clang++ -std=c++17 -O2 -Wall -Wextra -Werror -pedantic -pthread -I. compiler/native/<test>.cpp -o .work/qopt01/<test>.exe
```

Results:

```text
vkf_retained_optimization_schedule_test  PASS
vkf_adaptive_optimizer_contract_test     PASS
2 passed, 0 failed, 15809.8 ms compile plus run
```

## Native consumer verification

Environment:

```text
Microsoft Windows 10.0.26200, X64
Clang 22.1.4 (llvm-project 35990504507d79e0b9deb809c8ee5e1b34ceef20)
MSVC 19.29.30159.0
CMake 4.3.0
```

Ninja was unavailable. The first Visual Studio configure under the long
OneDrive worktree failed before source compilation with `FTK1011` file-tracker
path errors. The same source graph configured from the verified short build
directory `C:\w\qopt01` and built these Release targets successfully:

```text
vkf_retained_optimization_schedule_test
vkf_adaptive_optimizer_contract_test
vkf_x64_artifact
```

Both MSVC test executables ran with exit 0. The production x64 artifact target
compiled and linked, proving the changed adaptive header remains consumable by
the real backend. The environment failures were not retried as tests or counted
as test results.

SHA-256 at final GREEN:

| Artifact | SHA-256 |
| --- | --- |
| retained schedule header | `518E58522FC56FC7FBDA71A755D35D1E219D8F61581F9F332C1F81E3D96D240E` |
| retained schedule test | `FCB1E951DD02C6BA373A7B01909B1261F58123415A19F45DC83A20D5668AF7D4` |
| adaptive optimizer header | `FB0288D6CC57D5D6C63B65B467A90936258E5D84FB877541D9096C23768D6706` |
| adaptive contract test | `8F768EAE8B7907D0776D6AF6ED3158226584A7EB93D657BBF3F895D133B596F4` |
| native CMake graph | `24EA79185708A26B630E8F890EEFC16F043EAD14A8671DB6F492F2DADF01CE09` |
| strict Clang schedule test | `61778801FD2AF7AEEEFF7BF65E74DAD862886567AEBE1C1D5D3E3B76A6894E7F` |
| MSVC schedule test | `5723878BB97F4E45101B95C02F27B193EEE357A30187ADA7486135BF9E525A85` |
| MSVC x64 artifact | `CA97F080D13B229C42708FF0EA90420C49911D2C103A71CC82D8B94745A29ADB` |

## Limitations and remaining gates

This packet freezes a private proof seam, not the shipped automatic driver.
Remaining work is explicit:

- serialize retained per-function evidence atomically and bind it to compiler,
  host, implementation, workload, oracle, and function fingerprints;
- integrate the two-policy changed-function plan into `tune_machine_code`;
- migrate the legacy production CPU-pair selector to measured decisions and
  remove the static-threshold path only after artifact parity tests pass;
- surface stale/corrupt cache and rejected-measurement reasons in private build
  receipts rather than treating them as indistinguishable misses;
- reconcile separate four-worker experiments before extending beyond a pair;
- add GPU/device proof keys, stable reduction trees, cancellation, and failure
  propagation; and
- run paired raw-sample parent/release evidence on an exclusive runner, then
  obtain independent verification under ADR 0010.

No frontier-performance claim is made by this packet.

## Lane estimate

The quantum optimization lane is estimated at **57% complete**, with medium-low
confidence (about +/-8 points). The weighted basis is: audit/model 10/10,
statistical proof and parity 20/20, bounded exploration 7/15, retained reuse
7/15, dependency-safe parallel execution 8/15, explicit failure reporting
5/10, and shipped integration plus independent performance evidence 0/15.
There is no canonical quantum-lane roadmap, so the weighting is stated rather
than presented as release fact.

No Language Design Authority decision is required. The packet does not merge
or push and is independently revertible.
