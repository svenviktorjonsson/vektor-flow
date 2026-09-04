# QOPT-07: cache durability and negative retention

Date: 2026-09-04

## Packet

- Lane: private automatic/quantum optimization proof.
- Base: `2109969dff76ebc8637ce6b2ee51d4249c27e457` (QOPT-06).
- Branch: `codex/quantum/qopt07-cache-durability`.
- Worktree: `.worktrees/quantum/qopt07-cache-durability`.
- Public VKF syntax, semantics, APIs, diagnostics, schemas, and ABIs:
  unchanged.
- Explicit research `tune`, proof thresholds, exact parity, the two-candidate
  miss policy, and dependency/parallelism gates: unchanged.

Owned paths:

- `compiler/native/CMakeLists.txt`
- `compiler/native/vkf_retained_optimization_cache.hpp`
- `compiler/native/vkf_retained_optimization_cache_test.cpp`
- `compiler/native/vkf_retained_optimization_schedule.hpp`
- `compiler/native/vkf_retained_optimization_driver.hpp`
- `compiler/native/vkf_retained_optimization_driver_test.cpp`
- `compiler/native/vkf_retained_optimization_composition.hpp`
- `compiler/native/vkf_retained_optimization_composition_test.cpp`
- `compiler/native/vkf_x64_artifact.cpp`
- `docs/evidence/qopt07-cache-durability-negative-retention.md`

## Private behavior

The private proof-cache schema advances from 1 to 2. Records now carry the
measurement epoch and an optional negative expiry. Schema-1 records fail
closed as `corrupt` and cause the already-bounded two-candidate remeasurement;
this is a private cache invalidation, not a public format change.

A deterministic, exact-output measurement rejected only as `not-faster` or
`unproven` may retain the explicit baseline for 86,400 seconds. Before expiry,
load reports `negative-program-hit` or `negative-function-hit`, and scheduling
returns `reused-negative-proof` with `mask-0`, no exploration, and optimization
disabled. A changed function still reports `function-mismatch`. At the exact
expiry boundary, load reports `negative-expired`, carries no decision, and the
driver schedules exactly `mask-0` plus the one guided candidate. Incorrect
output, invalid timings, insufficient samples, nondeterminism, and malformed
expiry metadata are never retained as negative decisions.

Every existing cache file has a sibling lock file. Windows uses a blocking
shared/exclusive `LockFileEx`; POSIX uses shared/exclusive `flock`. Readers hold
a shared lock across size/read/parse/proof validation. Writers hold an
exclusive lock across old-record validation, deterministic selection, durable
temporary write, and atomic replacement.

Writer precedence is independent of arrival order:

1. only deterministic, proof-admissible positive or bounded-negative records
   may supersede;
2. the greatest measurement epoch wins; and
3. equal epochs use the lexicographically least canonical record bytes.

An older valid writer reports `superseded`. A parseable high-timestamp record
with parity failure cannot block recovery. Equal-time writes converge to the
same bytes in both arrival orders.

Successful `stored` now means:

- record bytes were flushed before replacement (`FlushFileBuffers` on Windows,
  `fsync` on POSIX);
- the destination name was replaced atomically; and
- the namespace update used `MOVEFILE_WRITE_THROUGH` on Windows or a parent
  directory `fsync` on POSIX.

The store receipt exposes `durability_confirmed`. A data or namespace flush
failure reports `durability-error`; replacement and lock failures remain
explicit `io-error`. No error path selects an unproven policy or silently
falls back.

Production whole-entry and per-function request construction supplies the
same current epoch and fixed 24-hour private negative-retention policy. The
toolchain fingerprint revision is `x64-emitter-qopt07`, so older proof/cache
boundaries cannot authorize this revision.

## Vertical TDD receipt

1. Negative retention RED failed strict compilation because request clock/TTL,
   `NegativeProgramHit`, `NegativeExpired`, and `ReusedNegativeProof` did not
   exist. GREEN stored the measured baseline, reused it at second 1,059, and
   rejected it at second 1,060 with exactly two miss candidates.
2. Concurrent-writer RED failed strict compilation because `Superseded` did
   not exist. GREEN used process-scoped OS locks and deterministic compare and
   replace. Eight older writers were rejected while four concurrent readers
   performed 100 complete reads each.
3. Durability RED failed strict compilation because the store receipt lacked
   `durability_confirmed`. GREEN added data and namespace synchronization and
   made the flag true only for fully completed storage.
4. Poisoned-record RED exited 1:

   ```text
   a proof-invalid record must not supersede a valid durable writer
   ```

   GREEN excluded invalid-parity, nondeterministic, and malformed-retention
   records from writer precedence.
5. Composition-policy RED failed strict compilation because its request lacked
   the clock/TTL fields. GREEN propagated the exact policy to every private
   per-function driver request.

The first multi-process execution exposed Windows `cmd.exe` quoting of the
long worktree path, not a cache failure. The harness was corrected to invoke
children directly with `CreateProcessW`; the final Clang and MSVC process gates
both passed. This was an explained harness correction, not a retried flaky
cache result.

## Verification

Strict focused command:

```text
clang++ -std=c++17 -O2 -Wall -Wextra -Werror -pedantic -I.
  compiler/native/<test>.cpp -o .work/qopt07/<test>.exe
```

Strict real-backend command retained `-Werror` and only the translation unit's
pre-existing warning suppressions:

```text
clang++ -std=c++17 -O2 -Wall -Wextra -Werror
  -Wno-missing-field-initializers -Wno-reorder-ctor
  -Wno-unused-parameter -Wno-unused-variable -Wno-unused-function
  -pedantic -DVKF_X64_BACKEND_LIBRARY -I. -Inative/VfOverlay
  compiler/native/vkf_retained_optimization_driver_integration_test.cpp
  compiler/native/vkf_x64_artifact.cpp native/VfOverlay/vf/json.cpp
  -o .work/qopt07/integration.exe
```

Strict Clang passed:

- `vkf_optimization_dependency_gate_test`
- `vkf_retained_optimization_composition_test`
- `vkf_retained_optimization_driver_test`
- `vkf_retained_optimization_schedule_test`
- `vkf_retained_optimization_cache_test`
- `vkf_adaptive_optimizer_contract_test`
- `vkf_retained_optimization_driver_integration_test`

Clean `C:\w\qopt07` MSVC 19.29 Release built the same seven tests plus
standalone `vkf_x64_artifact`; all seven tests passed.

Final salient output:

```text
retained optimization cache: stored=1 program_hit=1 function_hit=1 atomic_reject=1 corrupt_reject=1 concurrent=1 superseded=8 process_concurrent=1 deterministic_tie=1 selected=1
retained optimization driver: cache=missing candidates=2 retained=program-hit parity=incorrect-output changed=function-mismatch slower=measurement-rejected negative=negative-program-hit negative_function=negative-function-hit expired=negative-expired store=io-error
retained optimization composition: functions=2 unchanged=function-hit changed=function-mismatch reason=all-proven
retained optimization driver integration: candidates=4 incremental_candidates=2 exact_output=1 call_candidates=2
```

Final SHA-256:

```text
2d4708c1417d7e3c0ebc8ce847c6855ab3c4cd9578477eab5c92721376ce5b72  compiler/native/CMakeLists.txt
dc65f1d778f04c1c5ef57a76e071b96c0ad102649d055013381f0728e99542dd  compiler/native/vkf_retained_optimization_cache.hpp
ab7c64bc4b9f4f20c05c38bd95f6efad9d31e7decd13e6dd413e3e32923938bc  compiler/native/vkf_retained_optimization_cache_test.cpp
424c5ca1f591d41b7bd6707a21e14c7c2e5d998472602c2068f7d5b822dc5095  compiler/native/vkf_retained_optimization_schedule.hpp
be004abd88cceb604aa9735ae9cb9caa1bbc51e57d1a80ef6465201c18e7a127  compiler/native/vkf_retained_optimization_driver.hpp
d57a580df93792ae09431b2e6be8a86c9664ff1180b0ef716a39d320329cc245  compiler/native/vkf_retained_optimization_driver_test.cpp
5b599bdfc05e3035d30e119e1d8129f2f0e50fc5b1839bab4105265804115957  compiler/native/vkf_retained_optimization_composition.hpp
62a65fc91ea61421ceb84c386e6c57c2edf3ee75f6f266cb431b94cac6c0918c  compiler/native/vkf_retained_optimization_composition_test.cpp
428c52896dc0dba0940ff8c1521461fd913bbec8126bd618506709e5e4e7f25d  compiler/native/vkf_x64_artifact.cpp
6ab66da5b9f826bc80b7a117e55643ea3c3e6434bb41d1540d0cc98889f4c67b  clang/cache.exe
4d6e1d90a0da7dc3d1970dfaa1fd2ba6c99e59bec8f6969b10979602e01261fb  clang/driver.exe
98ecb36dd1784318f454f14746c5e8bddb2d20689b495d91e1358886403c3715  clang/composition.exe
db86b636f7e42f9a24aabc14f667302f45379dce844040ec6ccdccf52ce45ce0  clang/integration.exe
140115c755b6b90bc7b586990e1211980392ae1615acd8176fa3db678f79a085  msvc/vkf_retained_optimization_cache_test.exe
d9ece31ed59b261a92fab4c41cfc66530f47a4bec80dcec0fd2388cf60b94f10  msvc/vkf_retained_optimization_driver_test.exe
3cb6647694a19c1dd47c49975d31030e1f694682e6155d9c41d7a01ef7fcdcc2  msvc/vkf_retained_optimization_composition_test.exe
47b298a725f1fcc53d918f07badee715b29f9683c1c45a48132a8a9f2d9304d3  msvc/vkf_retained_optimization_driver_integration_test.exe
d28999f8625911490faab615c75e7f699df94e1b1b4c10d0e41586146cf14590  msvc/vkf_x64_artifact.exe
```

## Limits and next gates

- The final test covers same-process threads and real concurrent child
  processes on Windows. POSIX locking, rename, and directory-sync branches were
  neither compiled nor executed on this Windows host and require Linux CI.
- Guarantees assume a local filesystem honoring `LockFileEx`/`flock`, atomic
  replacement, and flush primitives. Network/distributed filesystem semantics
  are not claimed.
- Power-loss fault injection was not available. The implementation checks and
  reports every flush/replacement call, but physical device write-cache
  guarantees remain platform/storage dependent.
- Lock-file admission, stale-file pruning, cache quotas, permissions hardening,
  and wall-clock skew policy remain operational follow-ups.
- Complete call graphs still require value/alias independence before wider
  parallel execution. GPU, stable reductions, cancellation/failure scheduling,
  and independent ADR-0010/T4 performance verification remain.

## Lane estimate

The quantum optimization lane is estimated at **94% complete**, with
medium-high confidence (about +/-4 points). Explicit 100-point weighting:
audit/model 10/10; statistical proof and exact parity 20/20; bounded one-shot
exploration 15/15; retained reuse 15/15; dependency-safe composition/parallel
execution 14/15; explicit failure reporting 10/10; shipped integration plus
independent performance evidence 10/15.

No Language Design Authority decision is required. This packet is private,
independently revertible, and is not merged or pushed.
