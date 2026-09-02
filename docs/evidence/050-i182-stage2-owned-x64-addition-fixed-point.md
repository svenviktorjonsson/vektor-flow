# 050-I182 Stage-2-owned x64 addition evidence

## Scope

- Git base: `3442ec23`
- Consumed packet: committed I181 GREEN contract
- Worktree: `.worktrees/0.5/050-i142-machine-function-list-layout`
- Branch: `codex/0.5/050-i142-machine-function-list-layout`
- State: GREEN, uncommitted for Integration Steward review

I182 moves the settled addition operation from compile-time evaluation into
the Stage-2-emitted x64 program. The running Stage-2 compiler parses and lowers:

```vkf
value: 40
:: value + 50
```

It lowers the dynamic addition tape, converts both source operands to emitted
immediate bytes, emits two `push imm8` operations, selects the locked addition
tail, and writes the PE through direct `.io.write_bytes`. The program contains
this exact runtime sequence at its entry slot:

```text
6A 28       push 40
6A 32       push 50
58          pop rax
59          pop rcx
48 01 C8    add rax, rcx
F2 48 0F 2A C0
C3
```

The Stage-2 and Stage-3 artifacts both compute and print `90`, matching the
Stage-0 oracle. Program artifacts compare byte-for-byte equal, as do the
Stage-2, Stage-3, and Stage-4 compiler artifacts. The path invokes neither
`--vkf-internal-stage-observation` nor `process.run_native`.

This remains a bounded encoder: operand immediates are restricted to the
printable ranges used by the valid tracer, and register/add/return bytes are a
locked runner-tail fragment. General numeric encoding, instruction selection,
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
node --test tests/bootstrap/stage2-owned-x64-addition-fixed-point.test.mjs
```

- exit `1`, 0/1 passed in 11.62 s;
- intended failure: the generated Stage-2 compiler could not resolve the
  missing private runtime-addition emission function.

GREEN command: the RED command above.

- exit `0`, 1/1 passed in 11.69 s;
- Stage-2 and Stage-3 PEs both returned exact Stage-0 stdout `90`;
- both PEs contained the exact 15-byte runtime addition sequence;
- Stage-2/Stage-3 program artifacts were byte-identical;
- Stage-2/Stage-3/Stage-4 compiler artifacts were byte-identical.

Focused differential command:

```powershell
node --test `
  tests/bootstrap/stage2-owned-x64-addition-fixed-point.test.mjs `
  tests/bootstrap/stage2-owned-x64-artifact-fixed-point.test.mjs `
  tests/bootstrap/stage2-locked-source-graph-fixed-point.test.mjs `
  tests/bootstrap/stage1-bootstrap-source-graph.test.mjs
```

- exit `0`, 5/5 passed in 15.20 s;
- prior constant emission and graph materialization stayed exact;
- canonical source and bundle identities remained locked.

Locked-bundle command:

```powershell
$env:VKF_BOOTSTRAP_FRONTEND_BIN=$env:VKF_NATIVE_BIN
$env:VKF_BUNDLE_ARTIFACT_TOOL=
  'J:\build\i150-release-fast\bin\Release\vkf_bootstrap_bundle_artifact_smoke.exe'
node --test tests/bootstrap/stage1-bootstrap-executable-bundle.test.mjs
```

- exit `0`, 1/1 passed in 41.86 s;
- every declared compiler source emitted as an executable and ran.

`git diff --check` passed; Git reported only existing LF-to-CRLF warnings. The
Git index remained clean after the I181 commit.

## Contract hashes

- ADR 0005 canonical bytes:
  `96A0552F3104475533AFFA66456CDCF9D0F187629865357A1181DB6250CE7BB1`
- bootstrap bundle identity:
  `E65BAC9E6C3E4A8224AAE6829689D35FC988353CE37A5C0EA2DCEE834E327E5D`
- bootstrap manifest checkout bytes:
  `83FC0398EB444C69884C05578939CA0E5C2656B47E798F197221BC17A606C706`
- canonical compiler facade source:
  `7FE138E27C65426969349A05C9234DD81D2C0E4D7E7384E51C8A8B8B93C9B595`
- I182 acceptance test canonical bytes:
  `AE28F5C55293FC0E69BA869E870A1249ED4657B78F1C0890D67F55C010B8CD4D`

## Acceptance-gate impact

This closes the first settled binary Machine-IR operation executed at runtime
inside a Stage-2-owned x64 artifact and reproduced at the bounded Stage-3
fixed point. Gate 6 remains open because encoding is not general and the full
locked compiler graph is not yet compiled into Stage 3.

Re-evaluated from I181's 86.2%, 0.5.0 is conservatively **86.8% total**, **+0.6
percentage points** for runtime addition emission and exact fixed-point
execution.

## Handoff inventory

I182 adds one private runtime-addition emitter, rotates the locked compiler and
bundle hashes, adds one focused test, and records this receipt. Existing dirty
files and untracked `.work/` content remain preserved. No commit, push, or
merge was performed for I182.
