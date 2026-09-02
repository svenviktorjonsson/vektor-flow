# 050-I183 Stage-2-owned x64 subtraction evidence

## Scope

- Git base: `8078c169`
- Consumed packet: committed I182 GREEN contract
- Worktree: `.worktrees/0.5/050-i142-machine-function-list-layout`
- Branch: `codex/0.5/050-i142-machine-function-list-layout`
- State: GREEN, uncommitted for Integration Steward review

I183 extends valid-input Stage-2-owned native emission with the settled
subtraction operation. The running Stage-2 compiler parses and lowers:

```vkf
value: 90
:: value - 40
```

It verifies the locked `load-load-subtract-print` Machine-IR tape, converts
both source operands to emitted immediate bytes, emits two `push imm8`
operations, selects the locked subtraction tail, and writes the PE through
direct `.io.write_bytes`. The program contains this runtime sequence:

```text
6A 5A       push 90
6A 28       push 40
58          pop rax
59          pop rcx
48 29 C1    sub rcx, rax
48 89 C8    mov rax, rcx
F2 48 0F 2A C0
C3
```

The Stage-2 and Stage-3 artifacts both compute and print `50`, matching the
Stage-0 oracle. Program artifacts compare byte-for-byte equal, as do the
Stage-2, Stage-3, and Stage-4 compiler artifacts. The path invokes neither
`--vkf-internal-stage-observation` nor `process.run_native`.

This remains a bounded encoder: operand immediates use the printable ranges
required by the valid tracer, and register/subtract/return bytes are a locked
runner-tail fragment. General numeric encoding, instruction selection,
relocation, and complete compiler-graph emission remain open. No invalid input
runs, so the unresolved invalid-source diagnostic contract is untouched.

## RED and GREEN receipts

Environment: Windows x64, Node `v24.11.0`, CMake `4.3.0`, MSBuild `16.11.6`.
All child processes used hidden windows. No UI, browser, renderer, or benchmark
workload ran.

RED command:

```powershell
$env:VKF_NATIVE_BIN='J:\build\i150-release-fast\bin\Release'
$env:VKF_TEST_WORK_ROOT='J:\.work'
node --test tests/bootstrap/stage2-owned-x64-subtraction-fixed-point.test.mjs
```

- exit `1`, 0/1 passed in 10.84 s;
- intended failure: the generated Stage-2 compiler could not resolve the
  missing private runtime-subtraction emission function.

During GREEN, a focused observation exposed the authoritative subtraction
opcode as `6`, not the initial test expectation `5`. The assertion was aligned
with the already-settled Machine-IR mapping before the final run.

GREEN command: the RED command above.

- exit `0`, 1/1 passed in 25.98 s;
- Stage-2 and Stage-3 PEs both returned exact Stage-0 stdout `50`;
- both PEs contained the exact 18-byte runtime subtraction sequence;
- Stage-2/Stage-3 program artifacts were byte-identical;
- Stage-2/Stage-3/Stage-4 compiler artifacts were byte-identical.

Focused differential command:

```powershell
node --test `
  tests/bootstrap/stage2-owned-x64-subtraction-fixed-point.test.mjs `
  tests/bootstrap/stage2-owned-x64-addition-fixed-point.test.mjs `
  tests/bootstrap/stage2-owned-x64-artifact-fixed-point.test.mjs `
  tests/bootstrap/stage2-locked-source-graph-fixed-point.test.mjs `
  tests/bootstrap/stage1-bootstrap-source-graph.test.mjs
```

- exit `0`, 6/6 passed in 32.85 s;
- prior constant and addition emission stayed exact;
- graph materialization and canonical bundle identities stayed locked.

Locked-bundle command:

```powershell
$env:VKF_BOOTSTRAP_FRONTEND_BIN=$env:VKF_NATIVE_BIN
$env:VKF_BUNDLE_ARTIFACT_TOOL=
  'J:\build\i150-release-fast\bin\Release\vkf_bootstrap_bundle_artifact_smoke.exe'
node --test tests/bootstrap/stage1-bootstrap-executable-bundle.test.mjs
```

- final isolated run: exit `0`, 1/1 passed in 40.32 s;
- every declared compiler source emitted as an executable and ran;
- two immediately preceding attempts reached the test's fixed 60-second
  timeout under concurrent host load; neither reported a semantic mismatch,
  and the isolated retry restored the prior approximately 40-second result.

`git diff --check` passed; Git reported only existing LF-to-CRLF warnings. The
Git index remained clean after the I182 commit.

## Contract hashes

- ADR 0005 canonical bytes:
  `96A0552F3104475533AFFA66456CDCF9D0F187629865357A1181DB6250CE7BB1`
- bootstrap bundle identity:
  `1827F1DC3EA09FCE75974BE16A7E2264FCB84FBCF869B83599215C38EB254B74`
- bootstrap manifest checkout bytes:
  `95C1894E7900C1DE2C085861D863E7CFA3B05D91C36F25E8DDA4FE875ECA2AD6`
- canonical compiler facade source:
  `3EDDF807F96C14E3174B124A721C60768D3E039E71094C43D4DC7BE2A1218478`
- I183 acceptance test canonical bytes:
  `7AC26201143C5159F8E2EBCA3E7F04FF6658995B37A81316237695D535FF8302`
- locked x64 runner template:
  `A5A11724BFFCEAF9BC0AD22F1F202F3435156D11251C06D7BD56A00222258EB8`

## Acceptance-gate impact

This closes a second settled binary Machine-IR operation executed at runtime
inside a Stage-2-owned x64 artifact and reproduced at the bounded Stage-3
fixed point. Gate 6 remains open because encoding is not general and the full
locked compiler graph is not yet compiled into Stage 3.

Re-evaluated from I182's 86.8%, 0.5.0 is conservatively **87.3% total**, **+0.5
percentage points** for runtime subtraction emission and exact fixed-point
execution.

## Handoff inventory

I183 adds one private runtime-subtraction emitter, rotates the locked compiler
and bundle hashes, adds one focused test, and records this receipt. Existing
dirty files and untracked `.work/` content remain preserved. No commit, push,
or merge was performed for I183.
