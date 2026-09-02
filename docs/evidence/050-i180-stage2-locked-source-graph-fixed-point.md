# 050-I180 Stage-2 locked-source-graph evidence

## Scope

- Git base: `203609e4`
- Consumed packet: committed I179 GREEN contract
- Worktree: `.worktrees/0.5/050-i142-machine-function-list-layout`
- Branch: `codex/0.5/050-i142-machine-function-list-layout`
- State: GREEN, uncommitted for Integration Steward review

I180 makes the running Stage-2 compiler consume all ten canonical compiler
source byte strings as one private source-graph value. Stage 2 materializes
that graph in a fresh Stage-3 directory and emits the next compiler artifact.
The Stage-3 compiler then consumes the Stage-2-emitted graph and reproduces it
in a fresh Stage-4 directory.

Node independently verifies every input against the locked manifest before
execution, then proves that every Stage-3 and Stage-4 source is byte-identical
to its predecessor. Stage-2, Stage-3, and Stage-4 compiler artifacts are also
byte-identical. The compiler path invokes neither
`--vkf-internal-stage-observation` nor `process.run_native`.

This is a source-graph ownership tracer toward Gate 6, not a claim that the
graph has been compiled by Stage 2. Stage 2 currently reproduces its compiler
executable while materializing the complete source graph; it does not yet
parse, lower, and emit a replacement compiler from those ten files. No invalid
source is supplied, so the unresolved invalid-source diagnostic contract is
untouched.

## RED and GREEN receipts

Environment: Windows x64, Node `v24.11.0`, CMake `4.3.0`. All child processes
used hidden windows. No UI, browser, renderer, or benchmark workload ran.

RED command:

```powershell
$env:VKF_NATIVE_BIN='J:\build\i150-release-fast\bin\Release'
$env:VKF_TEST_WORK_ROOT='J:\.work'
node --test tests/bootstrap/stage2-locked-source-graph-fixed-point.test.mjs
```

- exit `1`, 0/1 passed in 11.39 s;
- intended failure: the generated Stage-2 compiler could not resolve the
  missing private locked-source-graph compiler function.

GREEN command: the RED command above.

- exit `0`, 1/1 passed in 10.33 s;
- all ten Stage-3 source files matched the locked Stage-2 inputs byte-for-byte;
- all ten Stage-4 source files matched Stage 3 byte-for-byte;
- the Stage-2/Stage-3/Stage-4 compiler artifacts matched byte-for-byte;
- both emitted source-count receipts were exactly `10`.

Focused differential command:

```powershell
node --test `
  tests/bootstrap/stage2-locked-source-graph-fixed-point.test.mjs `
  tests/bootstrap/stage2-owned-output-fixed-point.test.mjs `
  tests/bootstrap/stage1-bootstrap-source-graph.test.mjs
```

- exit `0`, 4/4 passed in 13.42 s;
- the prior valid-output ownership tracer remained exact;
- canonical source and bundle identities remained locked.

Locked-bundle command:

```powershell
$env:VKF_BOOTSTRAP_FRONTEND_BIN=$env:VKF_NATIVE_BIN
$env:VKF_BUNDLE_ARTIFACT_TOOL=
  'J:\build\i150-release-fast\bin\Release\vkf_bootstrap_bundle_artifact_smoke.exe'
node --test tests/bootstrap/stage1-bootstrap-executable-bundle.test.mjs
```

- exit `0`, 1/1 passed in 33.61 s;
- every declared compiler source emitted as an executable and ran.

`git diff --check` passed; Git reported only the existing LF-to-CRLF warnings.
The Git index remained clean after the I179 commit.

## Contract hashes

- ADR 0005 canonical bytes:
  `96A0552F3104475533AFFA66456CDCF9D0F187629865357A1181DB6250CE7BB1`
- bootstrap bundle identity:
  `4EF008719E27E518F6D936C9B587CDD16CB25674CEF8FBB2CB532183721FDB5B`
- bootstrap manifest checkout bytes:
  `8FB3418353C1796228AAF093DF458C94C79EB053CD44175B6DDBE540B8E32545`
- canonical compiler facade source:
  `46FDDD906DEFB56A8353DF33B0AA3BACD0F540717D081CFF47E0B517EF5D7FD7`
- I180 acceptance test canonical bytes:
  `ADED9DD191563745D1883DB2E317A3CE1173C9545D23CEE49F6769DE6810F601`

## Acceptance-gate impact

This closes deterministic Stage-2 ownership and Stage-3 reproduction of the
complete locked compiler source graph. Gate 6 remains open because Stage 2 has
not compiled that complete graph into the Stage-3 executable, and the full
correctness/diagnostic/package/native/WASM suite has not run through Stage 3.

Re-evaluated from I179's 84.8%, 0.5.0 is conservatively **85.4% total**, **+0.6
percentage points** for complete locked-source-graph materialization and
reproduction.

## Handoff inventory

I180 adds one private compiler source-graph value constructor, rotates the
locked compiler and bundle hashes, adds one focused test, and records this
receipt. Existing dirty files and untracked `.work/` content remain preserved.
No commit, push, or merge was performed for I180.
