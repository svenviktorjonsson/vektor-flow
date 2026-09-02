# 050-I179 Stage-2-owned output and bounded fixed-point evidence

## Scope

- Git base: `563bd6fe`
- Consumed packet: uncommitted I178 GREEN contract
- Worktree: `.worktrees/0.5/050-i142-machine-function-list-layout`
- Branch: `codex/0.5/050-i142-machine-function-list-layout`
- State: GREEN, uncommitted for Integration Steward review

I179 removes the Stage-0 observation bridge from one complete valid-input
compiler path. A Stage-1-built compiler executable reads this settled source:

```vkf
value: 40
:: value + 2
```

The running Stage-2 compiler owns tokenization, parsing, typed lowering,
Machine-IR lowering, evaluation, bundle serialization, executable copying, and
creation of the next compiler artifact. It does not invoke
`--vkf-internal-stage-observation`, another compiler process, a C++ artifact
writer, a browser, or the renderer. The generated program returns exact Stage-0
stdout `42`.

The output follows ADR 0003's executable-plus-runtime-bundle model. A locked
runner executable reads the Stage-2-owned `stage2-program-output.txt` bundle.
Stage 2 writes both output files with direct `.io` byte/text capabilities. It
also writes the Stage-3 compiler artifact from its own bytes. Stage 3 repeats
the same valid compile, and the Stage-2/Stage-3 compiler artifacts, program
artifacts, and semantic bundles compare byte-for-byte equal.

This is deliberately a bounded first fixed-point tracer, not Gate 6 closure.
The Stage-3 compiler is reproduced from Stage 2 rather than rebuilt from the
complete locked compiler source graph, the runner remains a bootstrap artifact,
and arbitrary target machine-code emission remains open. No malformed input is
passed through this tracer, so it neither selects nor changes the unresolved
invalid-source diagnostic contract.

## RED and GREEN receipts

Environment: Windows x64, Node `v24.11.0`, CMake `4.3.0`. All child processes
used hidden windows. No UI, browser, renderer, or benchmark workload ran.

RED command:

```powershell
$env:VKF_NATIVE_BIN='J:\build\i150-release-fast\bin\Release'
$env:VKF_TEST_WORK_ROOT='J:\.work'
node --test tests/bootstrap/stage2-owned-output-fixed-point.test.mjs
```

- exit `1`, 0/1 passed in 17.22 s;
- the Stage-0 oracle compiled and returned exact stdout `42`;
- intended failure: the Stage-2 compiler source could not resolve the missing
  self-hosted valid-output evaluator and therefore emitted no Stage-2 output.

GREEN command: the RED command above.

- exit `0`, 1/1 passed in 12.02 s;
- Stage-2 and Stage-3 generated programs both matched Stage-0 stdout `42`;
- Stage-2/Stage-3 compiler bytes were identical;
- Stage-3/next compiler bytes were identical;
- Stage-2/Stage-3 executable and semantic-bundle bytes were identical;
- the Stage-2 compiler source contains no internal-observation adapter call.

Focused differential command:

```powershell
node --test `
  tests/bootstrap/stage2-owned-output-fixed-point.test.mjs `
  tests/bootstrap/stage2-unbounded-addition-chain-compiler-cli.test.mjs `
  tests/bootstrap/stage2-dynamic-arithmetic-chain-compiler-cli.test.mjs `
  tests/bootstrap/stage1-bootstrap-source-graph.test.mjs
```

- exit `0`, 5/5 passed in 16.16 s;
- the prior dynamic and unbounded arithmetic paths stayed exact;
- all ten canonical compiler-source hashes and the bundle identity matched.

Locked-bundle command:

```powershell
$env:VKF_BOOTSTRAP_FRONTEND_BIN=$env:VKF_NATIVE_BIN
$env:VKF_BUNDLE_ARTIFACT_TOOL=
  'J:\build\i150-release-fast\bin\Release\vkf_bootstrap_bundle_artifact_smoke.exe'
node --test tests/bootstrap/stage1-bootstrap-executable-bundle.test.mjs
```

- exit `0`, 1/1 passed in 31.14 s;
- every declared compiler source emitted as an executable and ran.

`git diff --check` passed; Git reported only the existing LF-to-CRLF warnings.

## Contract hashes

- ADR 0005 canonical bytes:
  `96A0552F3104475533AFFA66456CDCF9D0F187629865357A1181DB6250CE7BB1`
- bootstrap bundle identity:
  `5FDD5D5CE4474CAF4AB0B5A04B0A97E7D327D8E493BA8C67CF8D771EB05DD789`
- bootstrap manifest checkout bytes:
  `30D7792C13D7A2B993420312FCB98B346F77CA6C36BAAFCFA2375B9452A6ABF8`
- canonical compiler facade source:
  `5656C56C0CAF22D76FA0891A866B366B871ADD1F39F974427A6BF3356F15B952`
- I179 acceptance test canonical bytes:
  `0B90562D2144B03B69A94026D2346FE69F64A53858B76059213651298B5A1E2F`

## Acceptance-gate impact

This closes the first valid compiler path whose final output is owned by the
running Stage-2 executable instead of the Stage-0 observation consumer, and it
adds the first bounded Stage-2/Stage-3 byte comparison. Gate 6 remains open
because the complete compiler is not rebuilt by Stage 2, the full suite is not
run through Stage 3, and general native artifact encoding is not self-hosted.

Re-evaluated from I178's 83.8%, 0.5.0 is conservatively **84.8% total**, **+1.0
percentage point** for this valid-output ownership and bounded fixed-point
subgate.

## Handoff inventory

I179 adds one private valid-output evaluator to `compiler.vkf`, rotates the
locked graph hashes, adds one focused test, and records this receipt over the
layered I162-I178 state. Existing dirty files and untracked `.work/` content
remain preserved. No commit, push, or merge was performed.
