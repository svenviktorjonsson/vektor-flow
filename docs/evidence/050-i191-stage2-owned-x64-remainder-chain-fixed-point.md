# 050-I191 Stage-2-owned remainder-chain evidence

## Scope

- Git base: `729f6fc4`
- Consumed packet: committed I190 GREEN contract
- Worktree: `.worktrees/0.5/050-i142-machine-function-list-layout`
- Branch: `codex/0.5/050-i142-machine-function-list-layout`
- State: GREEN, uncommitted for Integration Steward review

I191 advances Gate 6 opcode coverage by composing positive integer remainder
inside a longer Machine-IR tape:

```vkf
value: 90
:: value % 40 + 65
```

The self-hosted compiler walks the tape, emits a signed integer remainder
fragment that pushes its result back onto the runtime stack, then consumes it
through the existing addition and print fragments. The selected 27-byte x64
stream is:

```text
6A 5A                   push 90
6A 28                   push 40
59 58 48 99             load operands; sign-extend dividend
48 F7 F9 52             divide; push remainder
6A 41                   push 65
58 59 48 01 C8 50       add and push
58 F2 48 0F 2A C0 C3    print result
```

Stage 2 and Stage 3 print `75`, exactly matching Stage 0. Their generated
programs are byte-identical, as are the Stage-2, Stage-3, and Stage-4 compiler
artifacts. The path uses neither `--vkf-internal-stage-observation` nor
`process.run_native`.

The implementation factors the shared integer tape traversal behind two
private selector entrypoints and retains an explicit guard when a remainder
fragment is unavailable. Negative-remainder semantics remain outside this
valid-input slice. No public syntax, API, schema, ABI, or diagnostic changed.

## RED and GREEN receipts

Environment: Windows x64, Node `v24.11.0`, CMake `4.3.0`, MSBuild `16.11.6`.
Every child process used hidden windows. No UI, browser, renderer, or benchmark
workload ran.

RED command:

```powershell
$env:VKF_NATIVE_BIN='J:\build\i150-release-fast\bin\Release'
$env:VKF_TEST_WORK_ROOT='J:\.work'
node --test `
  tests/bootstrap/stage2-owned-x64-remainder-chain-fixed-point.test.mjs
```

- exit `1`, 0/1 passed in 12.78 s;
- intended failure: the generated Stage-2 compiler could not lower the
  missing private remainder-chain selector.

The first implementation run remained RED in 11.80 s because the self-hosted
path does not expose `.length()` on a `str`. The guard was expressed through
the already-supported string equality operation instead.

Final GREEN command: the RED command above.

- exit `0`, 1/1 passed in 14.47 s;
- Stage-2 and Stage-3 PEs returned exact Stage-0 stdout `75`;
- both contained the exact 27-byte compositional instruction stream;
- Stage-2/Stage-3 programs and Stage-2/3/4 compilers were byte-identical.

Focused differential command:

```powershell
node --test `
  tests/bootstrap/stage2-owned-x64-remainder-chain-fixed-point.test.mjs `
  tests/bootstrap/stage2-owned-x64-arithmetic-chain-fixed-point.test.mjs `
  tests/bootstrap/stage2-owned-x64-mixed-expression-fixed-point.test.mjs `
  tests/bootstrap/stage2-owned-x64-power-fixed-point.test.mjs `
  tests/bootstrap/stage2-owned-x64-remainder-fixed-point.test.mjs `
  tests/bootstrap/stage2-owned-x64-floor-division-fixed-point.test.mjs `
  tests/bootstrap/stage2-owned-x64-division-fixed-point.test.mjs `
  tests/bootstrap/stage2-owned-x64-multiplication-fixed-point.test.mjs `
  tests/bootstrap/stage2-owned-x64-subtraction-fixed-point.test.mjs `
  tests/bootstrap/stage2-owned-x64-addition-fixed-point.test.mjs `
  tests/bootstrap/stage2-owned-x64-artifact-fixed-point.test.mjs `
  tests/bootstrap/stage2-locked-source-graph-fixed-point.test.mjs `
  tests/bootstrap/stage1-bootstrap-source-graph.test.mjs
```

- exit `0`, 14/14 passed in 39.16 s;
- every earlier native primitive, compositional tape, fixed-point graph, and
  bundle identity remained exact.

Locked-bundle command:

```powershell
$env:VKF_BOOTSTRAP_FRONTEND_BIN=$env:VKF_NATIVE_BIN
$env:VKF_BUNDLE_ARTIFACT_TOOL=
  'J:\build\i150-release-fast\bin\Release\vkf_bootstrap_bundle_artifact_smoke.exe'
node --test tests/bootstrap/stage1-bootstrap-executable-bundle.test.mjs
```

- exit `0`, 1/1 passed in 48.49 s;
- every declared compiler source emitted as an executable and ran.

`git diff --check` passed with only existing LF-to-CRLF warnings. The Git
index remained clean after the I190 commit.

## Contract hashes

- ADR 0005 canonical bytes:
  `96A0552F3104475533AFFA66456CDCF9D0F187629865357A1181DB6250CE7BB1`
- bootstrap bundle identity:
  `0ED5F0F817181965166981967BCDAAE413880B704CA3B818541D6A638BDFA89C`
- bootstrap manifest checkout bytes:
  `C0CA8356E635090D84D1C67FDB400A298A025AB30FC35DFD7B970EFD551E5B21`
- canonical compiler facade source:
  `C9B04F1B0B878FF484A00239417857A1455CEE4389A2F0FF0E9AE3211E072DD7`
- I191 acceptance test canonical bytes:
  `E29166AA33E5380916BC8216DF3A4172FCD921128784CF0FEE375B31632CC5B2`
- locked x64 runner template:
  `A5A11724BFFCEAF9BC0AD22F1F202F3435156D11251C06D7BD56A00222258EB8`

## Acceptance-gate impact

I191 proves that Stage 2 can compose a division-family integer opcode with a
subsequent operation rather than treating it as a terminal primitive. Gate 6
remains open on wider value encoding, remaining compositional opcode families,
relocation, and compilation of the complete locked compiler graph into
Stage 3.

Re-evaluated from I190's 91.1%, 0.5.0 is conservatively **91.6% total**, **+0.5
percentage points** for compositional remainder selection and a shared guarded
integer-tape traversal with exact Stage-0/2/3 behavior.

## Handoff inventory

I191 deepens the private integer tape selector, rotates compiler and bundle
hashes, adds one fixed-point test, and records this receipt. Existing dirty
files and untracked `.work/` remain preserved. No commit, push, or merge was
performed for I191.
