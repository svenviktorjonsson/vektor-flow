# 050-I181 Stage-2-owned x64 artifact evidence

## Scope

- Git base: `39141a6d`
- Consumed packet: committed I180 GREEN contract
- Worktree: `.worktrees/0.5/050-i142-machine-function-list-layout`
- Branch: `codex/0.5/050-i142-machine-function-list-layout`
- State: GREEN, uncommitted for Integration Steward review

I181 replaces I179's valid-program sidecar result with the first Stage-2-owned
x64 instruction emission. The running Stage-2 compiler parses and lowers:

```vkf
value: 40
:: value + 10
```

It evaluates the private addition Machine-IR tape, converts result `50` to
immediate byte `0x32`, selects x64 `push imm8`, and joins that emitted prefix to
a locked runner prefix/tail. Direct `.io.write_bytes` writes the final PE. The
artifact contains `6A 32` at the runner entry slot and returns exact Stage-0
stdout `50` after the remaining locked x64 tail converts `rax` to `xmm0`.

Stage 2 also produces the next compiler artifact. Stage 3 repeats compilation
of the same valid source; Stage-2 and Stage-3 program artifacts are byte-for-
byte equal and execute identically. Stage-2, Stage-3, and Stage-4 compiler
artifacts are byte-for-byte equal. The compiler invokes neither
`--vkf-internal-stage-observation` nor `process.run_native`.

This is a bounded target-encoding tracer, not the complete compiler rebuild.
Only one printable signed-byte immediate and the already-settled dynamic
addition path are emitted by VKF. The PE container and conversion/return bytes
come from a locked bootstrap runner seed. Relocation, general instructions,
full-source parsing, and complete-graph compiler emission remain open. No
invalid source runs, so the unresolved invalid-source diagnostic is untouched.

## RED and GREEN receipts

Environment: Windows x64, Node `v24.11.0`, CMake `4.3.0`, MSBuild `16.11.6`.
All child processes used hidden windows. No UI, browser, renderer, or benchmark
workload ran.

Runner-seed build:

```powershell
cmake --build J:\build\i150-release-fast --config Release `
  --target vkf_x64_runner_template
```

- exit `0`; generated the existing runner seed used only as the locked PE
  container and fixed runtime tail.

RED command:

```powershell
$env:VKF_NATIVE_BIN='J:\build\i150-release-fast\bin\Release'
$env:VKF_TEST_WORK_ROOT='J:\.work'
node --test tests/bootstrap/stage2-owned-x64-artifact-fixed-point.test.mjs
```

- exit `1`, 0/1 passed in 9.24 s;
- intended failure: the generated Stage-2 compiler could not resolve the
  missing private x64 emission function.

GREEN command: the RED command above.

- exit `0`, 1/1 passed in 11.92 s;
- Stage-2 and Stage-3 PEs both returned exact Stage-0 stdout `50`;
- both PEs contained emitted bytes `6A 32` at the runner entry;
- Stage-2/Stage-3 program artifacts were byte-identical;
- Stage-2/Stage-3/Stage-4 compiler artifacts were byte-identical.

Focused differential command:

```powershell
node --test `
  tests/bootstrap/stage2-owned-x64-artifact-fixed-point.test.mjs `
  tests/bootstrap/stage2-locked-source-graph-fixed-point.test.mjs `
  tests/bootstrap/stage2-owned-output-fixed-point.test.mjs `
  tests/bootstrap/stage1-bootstrap-source-graph.test.mjs
```

- exit `0`, 5/5 passed in 16.12 s;
- prior output ownership and complete graph materialization stayed exact;
- canonical source and bundle identities remained locked.

Locked-bundle command:

```powershell
$env:VKF_BOOTSTRAP_FRONTEND_BIN=$env:VKF_NATIVE_BIN
$env:VKF_BUNDLE_ARTIFACT_TOOL=
  'J:\build\i150-release-fast\bin\Release\vkf_bootstrap_bundle_artifact_smoke.exe'
node --test tests/bootstrap/stage1-bootstrap-executable-bundle.test.mjs
```

- exit `0`, 1/1 passed in 33.67 s;
- every declared compiler source emitted as an executable and ran.

`git diff --check` passed; Git reported only existing LF-to-CRLF warnings. The
Git index remained clean after the I180 commit.

## Contract hashes

- ADR 0005 canonical bytes:
  `96A0552F3104475533AFFA66456CDCF9D0F187629865357A1181DB6250CE7BB1`
- bootstrap bundle identity:
  `C2A3762ACB69C76B9BD70DEBD1CC874DDBE90CD2482B0F3D380E0094F7CCA153`
- bootstrap manifest checkout bytes:
  `587D7023524FAAA9D86A10E640AFB958EFD1F2E2D9E1F89A13578F30F9360A06`
- canonical compiler facade source:
  `93657E44BC9D3A68D96569920584E8C4FB3C349C5FF47FC4621E6C68B62E0B2C`
- I181 acceptance test canonical bytes:
  `ACF957CA97FD6C131FC250FA5E77C9714E7609E03E06A4FA09CE911FDC94FA6C`
- locked x64 runner seed checkout bytes:
  `A5A11724BFFCEAF9BC0AD22F1F202F3435156D11251C06D7BD56A00222258EB8`

## Acceptance-gate impact

This closes the first Stage-2-owned, source-derived x64 instruction and final
PE write at a bounded Stage-2/Stage-3 fixed point. Gate 6 remains open because
the instruction encoder is not general and the complete locked compiler graph
is not yet compiled into Stage 3.

Re-evaluated from I180's 85.4%, 0.5.0 is conservatively **86.2% total**, **+0.8
percentage points** for source-derived native instruction emission and exact
execution at the bounded fixed point.

## Handoff inventory

I181 adds one private x64 emission function, rotates the locked compiler and
bundle hashes, adds one focused test, and records this receipt. Existing dirty
files and untracked `.work/` content remain preserved. No commit, push, or
merge was performed for I181.
