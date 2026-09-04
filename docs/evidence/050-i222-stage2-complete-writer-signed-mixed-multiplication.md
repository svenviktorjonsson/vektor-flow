# 050-I222 Stage-2 complete-writer signed mixed multiplication evidence

## Scope

- Git base: `6c126c3a6ef992796833968770df9cf69c8c98e7` (I221)
- Worktree: `.worktrees/0.5/050-i222-stage3-signed-mixed-multiplication`
- Branch: `codex/0.5/050-i222-stage3-signed-mixed-multiplication`
- State: GREEN, ready for exact-scope commit

I222 carries a unary-negative integer through the typed multiplication writer
after true division has changed the left operand to floating representation.
The unchanged public VKF source is:

```vkf
value: 8
:: (value / 2) * -----3
```

Stage 0, Stage 2, and Stage 3 print exact `-12`. Supplying the private negate
selector routes this typed-multiplication call through the existing grouped
parser and representation-aware numeric tape. Calls that omit it retain their
previous parser and writer path.

The Stage-2 and Stage-3 programs are byte-identical. Their selected code is
`push 8`, `push 2`, integer true division to floating representation, `push 3`,
five integer negations, float-left-integer multiplication, and the floating
print tail. Stage-2, Stage-3, and Stage-4 compiler artifacts are byte-identical.
Generated Stage-2 source contains neither internal stage observation nor
`process.run_native`.

No public syntax, semantics, API, diagnostic, manifest schema, ABI, UI,
renderer, or native bootstrap implementation changed.

## RED and GREEN receipts

Environment: Windows x64, Node `v24.11.0`, CMake `4.3.0`. Child processes used
hidden windows. Existing ignored seed and smoke binaries were copied into this
isolated worktree's `.work/full-suite-bin`. Tests used `C:\w\vf-i222` to avoid
Windows nested-build path limits.

Focused command:

```powershell
$env:VKF_NATIVE_BIN=(Resolve-Path '.work/full-suite-bin').Path
$env:VKF_TEST_WORK_ROOT='C:\w\vf-i222'
node --test `
  tests/bootstrap/stage2-owned-x64-complete-signed-mixed-multiplication-fixed-point.test.mjs
```

- RED: exit `1`, 0/1 in 16.32 s. Stage 0 reported no matching overload for
  the typed-multiplication writer's absent private negate argument.
- GREEN: exit `0`, 1/1 in 20.55 s.

Adjacent signed/multiplication representation matrix:

```powershell
node --test --test-concurrency=1 `
  tests/bootstrap/stage2-owned-x64-complete-signed-mixed-multiplication-fixed-point.test.mjs `
  tests/bootstrap/stage2-owned-x64-float-integer-multiplication-fixed-point.test.mjs `
  tests/bootstrap/stage2-owned-x64-integer-float-multiplication-fixed-point.test.mjs `
  tests/bootstrap/stage2-owned-x64-float-float-multiplication-fixed-point.test.mjs `
  tests/bootstrap/stage2-owned-x64-signed-multiplication-fixed-point.test.mjs `
  tests/bootstrap/stage2-owned-x64-complete-signed-mixed-addition-fixed-point.test.mjs `
  tests/bootstrap/stage2-owned-x64-complete-floating-negation-fixed-point.test.mjs `
  tests/bootstrap/stage1-bootstrap-source-graph.test.mjs
```

- exit `0`, 9/9 in 134.18 s;
- all four multiplication representation pairs, standalone signed
  multiplication, the I220-I221 signed seams, and both source-lock assertions
  passed.

Locked Stage-2/Stage-3/Stage-4 source graph:

```powershell
node --test tests/bootstrap/stage2-locked-source-graph-fixed-point.test.mjs
```

- exit `0`, 1/1 in 18.21 s;
- all ten canonical sources and generated compiler artifacts remain exact
  through Stage 4.

Complete locked compiler bundle:

```powershell
node --test tests/bootstrap/stage1-bootstrap-executable-bundle.test.mjs
```

- exit `0`, 1/1 in 49.66 s;
- all ten declared compiler sources emitted as executables and ran.

`git diff --check` passed with only Git's existing LF-to-CRLF warnings.

## Contract hashes

- ADR 0005 canonical bytes:
  `96A0552F3104475533AFFA66456CDCF9D0F187629865357A1181DB6250CE7BB1`
- bootstrap bundle identity:
  `082FB25170568881F89B5CD4A6A06D3AC081F6EB3BA06DDEC8BF879AFA600B68`
- bootstrap manifest canonical bytes:
  `587062CAAC5F1385C6F80F32793D8D5283D5DA6AE6A48A3A8295BD4F1699446B`
- canonical compiler facade source:
  `BB14C3E3099AF5BDB41BA89DEFB86B73D0F6492184F974C33F7E5095FBA63CD1`
- I222 acceptance test canonical bytes:
  `AE8009A406DEB3F1038106297A41BBCA40EC63C93D320A4C88D7A92D6DA75F1E`
- strict Stage-0 seed compiler:
  `C6C450DD729F97F43F35067E7E0D4BE216EBD6059BB4B910BD40BCA89ED85336`
- locked x64 runner template:
  `8B501F0F67A5AA20E33F82DA8B1747E498A09BCE2BC2B4AD576A165CA792D039`

## Gate and performance impact

I222 advances ADR 0005 cutover rule 5's bounded fixed-point subgate: signed
input now crosses mixed float/integer multiplication in its general writer.
It does not claim full Stage-2/Stage-3 suite equivalence.

Existing calls omit the selector and retain their previous parser and output.
Signed calls add only existing representation dispatch and negate selection.
No timeout, performance threshold, or assertion was weakened, and this packet
makes no frontier performance claim.

Using the eight explicit ADR 0005 cutover rules, rules 1, 2, and 7 are
established; rules 3, 4, and 5 are materially but incompletely implemented;
rules 6 and 8 remain open. Counting each partial rule conservatively as one
half gives `4.5/8 = 56.25%`; the defensible rounded release estimate remains
**55%**.

Remaining work includes the same signed/general integration for subtraction
and division representation combinations; general relocations and artifact
encoding; full Stage-2/Stage-3 suite equivalence; stdlib/UI migration; fallback
removal; and a seed-only rebuild without C/C++, assembler, linker, Python, or a
platform SDK.
