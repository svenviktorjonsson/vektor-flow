# QOPT-02: atomic function-level proof cache

Date: 2026-09-04

## Packet

- Lane: private automatic/quantum optimization proof.
- Base: `edc0f42b8c1a98dc5717dc58f89b0db93eea7658` (QOPT-01).
- Branch: `codex/quantum/qopt02-atomic-proof-cache`.
- Worktree: `.worktrees/quantum/qopt02-atomic-proof-cache`.
- Consumed private contract: QOPT-01 retained proof-gated schedule.
- Public VKF syntax, semantics, API, diagnostics, schema, and ABI: unchanged.
- Compiler driver, 0.5 bootstrap/site, UI, renderer, and packaging paths:
  unchanged.

Owned paths:

- `compiler/native/vkf_retained_optimization_cache.hpp`
- `compiler/native/vkf_retained_optimization_cache_test.cpp`
- `compiler/native/CMakeLists.txt`
- `docs/evidence/qopt02-atomic-function-proof-cache.md`

## Observable private behavior

One cache file retains one function-level optimization proof. The record stores:

- the originating program fingerprint;
- the function fingerprint;
- host and toolchain fingerprints;
- the complete optimizer, implementation, host, workload-family,
  workload-shape, and oracle proof key;
- baseline and guided-candidate policies;
- the deterministic and exact-output-equivalence bits; and
- every paired baseline/candidate timing used by the proof gate.

Store reassesses the complete evidence before opening a temporary file. Only a
deterministic, exact-output candidate whose one-sided 95% upper confidence
ratio is below one can be persisted. A rejected record therefore cannot mutate
the existing cache.

The record is written beside its destination and exposed with one platform
atomic namespace replacement. Windows uses `MoveFileExW` with
`MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH`; POSIX uses same-directory
`rename`. A failed replacement removes its temporary file and returns an
explicit I/O receipt. This proves complete old-or-new namespace visibility; it
does not claim power-loss durability of file contents on every filesystem.

Load caps receipts at 1 MiB, strings at 4,096 bytes, and timing evidence at
4,096 pairs before accepting the record. It reparses and reassesses the proof,
then reports one typed, printable reason:

```text
program-hit
function-hit
missing
invalid-request
corrupt
nondeterministic
function-mismatch
host-mismatch
toolchain-mismatch
proof-key-mismatch
policy-mismatch
proof-rejected
io-error
```

An exact program/function match is `program-hit`. If only unrelated surrounding
code changes the program fingerprint while the function, host, toolchain,
proof key, and policies remain exact, the receipt is `function-hit` and the
QOPT-01 decision is reused without exploration. Every rejection carries no
decision. Corrupt or parity-failing data therefore cannot silently select the
baseline or candidate.

Changed one-shot code remains governed by QOPT-01: exactly `mask-0` plus one
guided candidate, never the 256-policy research landscape. Persistence does
not weaken exact parity, proof-before-selection, or dependency-safe parallel
execution.

## TDD receipt

Tracer RED:

```text
clang++ -std=c++17 -O2 -Wall -Wextra -Werror -pedantic -I. compiler/native/vkf_retained_optimization_cache_test.cpp -o .work/qopt02/vkf_retained_optimization_cache_test.exe
```

Exit 1 in 1633.0 ms solely because
`compiler/native/vkf_retained_optimization_cache.hpp` did not exist.

The first GREEN atomically stored a valid record, loaded an exact program hit,
and fed it into QOPT-01 without a new benchmark.

The receipt-reason RED then failed compilation at seven calls because no
printable `reason_name(LoadReason)` existed. GREEN distinguished program and
function hits from function, host, toolchain, proof-key, nondeterminism, and
missing-record rejections.

The atomic-rejection RED failed compilation at two calls because store reasons
were not printable. GREEN additionally proved:

- parity-rejected replacement leaves the old record byte-identical;
- valid replacement loads as one complete new program hit;
- OS replacement failure returns `io-error` and leaves zero temp files; and
- truncated data returns `corrupt` with no decision.

Final cache output:

```text
retained optimization cache: stored=1 program_hit=1 function_hit=1 atomic_reject=1 corrupt_reject=1 selected=1
```

## Verification

Environment:

```text
Microsoft Windows 10.0.26200, X64
Clang 22.1.4 (llvm-project 35990504507d79e0b9deb809c8ee5e1b34ceef20)
MSVC 19.29.30159.0
CMake 4.3.0
```

The focused QOPT chain compiled under strict Clang and passed 3/3 in
34,110.5 ms:

```text
vkf_retained_optimization_schedule_test
vkf_retained_optimization_cache_test
vkf_adaptive_optimizer_contract_test
```

The unchanged source graph was configured from the verified short path
`C:\w\qopt02`. MSVC Release built:

```text
vkf_retained_optimization_cache_test
vkf_retained_optimization_schedule_test
vkf_adaptive_optimizer_contract_test
vkf_x64_artifact
```

All three MSVC test executables passed in 697.6 ms. The real x64 artifact
consumer compiled and linked. The first post-build runner used `Release`
instead of CMake's `bin/Release` output path and launched no test; the corrected
invocation ran every executable once. No optimization fallback was used.

SHA-256 at final GREEN:

| Artifact | SHA-256 |
| --- | --- |
| cache header | `42D312397382BAA6581775A50F183EACD1D6270E7D8F296A19C641F353E9F395` |
| cache behavior test | `2DABE2568EF7E317642DB7619348CE012B98A5F90956887BBC4EB2D72C3D5082` |
| native CMake graph | `44CBD56C8FDA37759BBB6E1C03521BFD5B3A832826464037F07D69F7C37973E7` |
| strict Clang cache test | `B9C98918D33F59E2F2E4EB4A7DEBE32CF37BD0A59867175CC60FBF8D35D7ECF4` |
| MSVC cache test | `2B765337E2143DC0EC916160244B22547F7C1D19406F80A2D9256E2969BD30D3` |
| MSVC x64 artifact | `88EC8A252CCE7012F8D51F35CD21C60C5B6137DB7E40AD586B85CA59B546BE31` |

## Limitations and next gate

The cache is a private reference component and has not been wired into
`tune_machine_code`. The next dependency is a driver adapter that derives the
four fingerprints, selects one file per function, records hit/rejection reasons
in a private build receipt, and uses QOPT-01's two-policy plan only for misses.

Further gates remain:

- concurrent multi-process stress and a platform-independent durability policy;
- cache directory admission, ownership, permissions, pruning, and size budget;
- driver-visible corruption/rejection reporting without public diagnostics;
- legacy CPU-pair migration to measured proof;
- GPU, stable-reduction, cancellation, and failure-propagation proofs; and
- paired parent/release evidence on an exclusive runner with independent ADR
  0010 verification.

No performance-frontier claim is made.

## Lane estimate

The quantum optimization lane is estimated at **66% complete**, with medium-low
confidence (about +/-8 points). The same stated weighting as QOPT-01 now scores:
audit/model 10/10, statistical proof and parity 20/20, bounded exploration
7/15, retained reuse 13/15, dependency-safe parallel execution 8/15, explicit
failure reporting 8/10, and shipped integration plus independent performance
evidence 0/15.

No Language Design Authority decision is required. This packet does not merge
or push and is independently revertible.
