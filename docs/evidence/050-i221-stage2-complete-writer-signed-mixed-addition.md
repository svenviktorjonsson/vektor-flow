# 050-I221 Stage-2 complete-writer signed mixed addition evidence

## Scope

- Git base: `a8080db35922aa96604f26b16d5eadfac66c49a3` (I220)
- Worktree: `.worktrees/0.5/050-i221-stage3-signed-mixed-addition-writer`
- Branch: `codex/0.5/050-i221-stage3-signed-mixed-addition-writer`
- State: GREEN, ready for exact-scope commit

I221 carries a unary-negative integer through the complete addition writer
after true division has changed the left operand to floating representation.
The unchanged public VKF source is:

```vkf
value: 8
:: (value / 2) + -----3
```

Stage 0, Stage 2, and Stage 3 print exact `1`. Supplying the private negate
selector routes this complete-addition call through the existing grouped
parser and representation-aware numeric tape. Calls that omit it retain their
previous parser and writer path.

The Stage-2 and Stage-3 programs are byte-identical. Their selected code is
`push 8`, `push 2`, integer true division to floating representation, `push 3`,
five integer negations, float-left-integer addition, and the floating print
tail. Stage-2, Stage-3, and Stage-4 compiler artifacts are byte-identical.
Generated Stage-2 source contains neither internal stage observation nor
`process.run_native`.

No public syntax, semantics, API, diagnostic, manifest schema, ABI, UI,
renderer, or native bootstrap implementation changed.

## RED and GREEN receipts

Environment: Windows x64, Node `v24.11.0`, CMake `4.3.0`. Child processes used
hidden windows. Existing ignored seed and smoke binaries were copied into this
isolated worktree's `.work/full-suite-bin`. Tests used the genuinely short
work root `C:\w\vf-i221` to avoid Windows nested-build path limits.

Focused command:

```powershell
$env:VKF_NATIVE_BIN=(Resolve-Path '.work/full-suite-bin').Path
$env:VKF_TEST_WORK_ROOT='C:\w\vf-i221'
node --test `
  tests/bootstrap/stage2-owned-x64-complete-signed-mixed-addition-fixed-point.test.mjs
```

- RED: exit `1`, 0/1 in 10.41 s. Stage 0 reported no matching overload for
  the complete-addition writer's absent private negate argument.
- GREEN: exit `0`, 1/1 in 18.47 s.

Adjacent signed/addition representation matrix:

```powershell
node --test --test-concurrency=1 `
  tests/bootstrap/stage2-owned-x64-complete-signed-mixed-addition-fixed-point.test.mjs `
  tests/bootstrap/stage2-owned-x64-complete-floating-negation-fixed-point.test.mjs `
  tests/bootstrap/stage2-owned-x64-complete-signed-division-fixed-point.test.mjs `
  tests/bootstrap/stage2-owned-x64-complete-signed-addition-fixed-point.test.mjs `
  tests/bootstrap/stage2-owned-x64-float-integer-addition-fixed-point.test.mjs `
  tests/bootstrap/stage2-owned-x64-integer-float-addition-fixed-point.test.mjs `
  tests/bootstrap/stage2-owned-x64-float-float-addition-fixed-point.test.mjs `
  tests/bootstrap/stage1-bootstrap-source-graph.test.mjs
```

- exit `0`, 9/9 in 132.80 s;
- all four addition representation pairs, the I218-I220 signed seams, and both
  canonical source-lock assertions passed.

Locked Stage-2/Stage-3/Stage-4 source graph:

```powershell
node --test tests/bootstrap/stage2-locked-source-graph-fixed-point.test.mjs
```

- exit `0`, 1/1 in 17.72 s;
- all ten canonical sources and generated compiler artifacts remain exact
  through Stage 4.

Complete locked compiler bundle:

```powershell
node --test tests/bootstrap/stage1-bootstrap-executable-bundle.test.mjs
```

- exit `0`, 1/1 in 47.76 s;
- all ten declared compiler sources emitted as executables and ran.

`git diff --check` passed with only Git's existing LF-to-CRLF warnings.

## Contract hashes

- ADR 0005 canonical bytes:
  `96A0552F3104475533AFFA66456CDCF9D0F187629865357A1181DB6250CE7BB1`
- bootstrap bundle identity:
  `DCC1FCAD91B2FA497FBAA14B6DEC5811B08E5876801D0A49FDDFFA1E9814AA07`
- bootstrap manifest canonical bytes:
  `B4C5B2CC94F47EECF69CBAEDCD83ABAAF3ED003BFB1D54CEB8DAE3AAD13E5AD2`
- canonical compiler facade source:
  `6494582D4FB81D5AE2AC59B48C12C1C41F69B3C94521D280E8A216EF26EC2ACC`
- I221 acceptance test canonical bytes:
  `B3E2EFAC0691EB2706E1A8C10B11FB24295BF070CC4D30BBEDA9D5F6168AAB52`
- strict Stage-0 seed compiler:
  `C6C450DD729F97F43F35067E7E0D4BE216EBD6059BB4B910BD40BCA89ED85336`
- locked x64 runner template:
  `8B501F0F67A5AA20E33F82DA8B1747E498A09BCE2BC2B4AD576A165CA792D039`

## Gate and performance impact

I221 advances ADR 0005 cutover rule 5's bounded fixed-point subgate: signed
input now crosses a mixed float/integer arithmetic operation in the complete
addition writer. It does not claim full Stage-2/Stage-3 suite equivalence.

Existing calls omit the selector and retain their previous parser and output.
Signed calls add only the existing representation dispatch and negate opcode
selection. No timeout, performance threshold, or assertion was weakened, and
this packet makes no frontier performance claim.

Using the eight explicit ADR 0005 cutover rules, rules 1, 2, and 7 are
established; rules 3, 4, and 5 are materially but incompletely implemented;
rules 6 and 8 remain open. Counting each partial rule conservatively as one
half gives `4.5/8 = 56.25%`; the defensible rounded release estimate remains
**55%**.

Remaining work includes the same signed/general integration for multiplication,
subtraction, and division representation combinations; general relocations and
artifact encoding; full Stage-2/Stage-3 suite equivalence; stdlib/UI migration;
fallback removal; and a seed-only rebuild without C/C++, assembler, linker,
Python, or a platform SDK.
