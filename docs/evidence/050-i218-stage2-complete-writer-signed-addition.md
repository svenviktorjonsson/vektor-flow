# 050-I218 Stage-2 complete-writer signed addition evidence

## Scope

- Git base: `5bc05039`
- Consumed packets: committed I214 unary negation and I215-I217 signed
  arithmetic fixed-point contracts
- Worktree: `.worktrees/0.5/050-i218-stage3-next-fixed-point`
- Branch: `codex/0.5/050-i218-stage3-next-fixed-point`
- State: GREEN, ready for exact-scope commit

I218 moves unary-negative integer input from the standalone signed selector
into the established byte-arena-backed arithmetic writer. The unchanged public
VKF source is:

```vkf
value: 8
:: value + -----3
```

Stage 0, Stage 2, and Stage 3 print exact `5`. The complete writer consumes the
existing grouped tagged parser only when its new private negate selector is
present; all existing unsigned callers retain the prior parser path. The
general numeric writer rejects negation of a floating representation rather
than silently applying integer machine code.

The Stage-2 and Stage-3 programs are byte-identical. Their selected code is
`push 8`, `push 3`, five exact integer-negation selectors, integer addition,
and the established integer print tail. The Stage-2, Stage-3, and Stage-4
compiler artifacts are also byte-identical. The path contains neither internal
stage observation nor `process.run_native`.

No public syntax, semantics, API, diagnostic, manifest schema, ABI, UI,
renderer, or native bootstrap implementation changed.

## RED and GREEN receipts

Environment: Windows x64, Node `v24.11.0`, CMake `4.3.0`. Child processes used
hidden windows.

```powershell
$env:VKF_NATIVE_BIN=(Resolve-Path '.work/full-suite-bin').Path
$env:VKF_TEST_WORK_ROOT=(Join-Path (Get-Location) '.work/i218-local')
node --test `
  tests/bootstrap/stage2-owned-x64-complete-signed-addition-fixed-point.test.mjs
```

- RED: exit `1`, 0/1 in 9.85 s. Stage 0 rejected the absent private eighth
  `negate_code` argument on the complete writer.
- First implementation probe: exit `1`, 0/1 in 21.84 s. It exposed that the
  legacy complete wrapper still selected the non-unary parser.
- Second probe: exit `1`, 0/1 in 25.54 s. The one-minus fixture also requested
  a separate parser-width extension, so the test was narrowed to I215's
  already-proven five-minus public form rather than expanding this packet.
- GREEN after routing only negate-enabled calls through the existing grouped
  parser and retaining the settled source form: exit `0`, 1/1 in 36.47 s.
- Final isolated-local seed rerun: exit `0`, 1/1 in 25.64 s.

GREEN parent-contract and locked-source differential:

```powershell
node --test --test-concurrency=1 `
  tests/bootstrap/stage2-owned-x64-complete-signed-addition-fixed-point.test.mjs `
  tests/bootstrap/stage2-owned-x64-signed-multiplication-fixed-point.test.mjs `
  tests/bootstrap/stage2-owned-x64-signed-subtraction-fixed-point.test.mjs `
  tests/bootstrap/stage2-owned-x64-signed-addition-fixed-point.test.mjs `
  tests/bootstrap/stage2-owned-x64-complete-integer-writer-fixed-point.test.mjs `
  tests/bootstrap/stage1-bootstrap-source-graph.test.mjs
```

- exit `0`, 7/7 in 124.92 s;
- the complete byte-arena writer, all three prior signed operators, and both
  locked-source graph assertions passed.

Complete locked compiler bundle:

```powershell
subst Q: <this isolated worktree>
$env:VKF_TEST_WORK_ROOT='Q:\.work\i218-short'
node --test tests/bootstrap/stage1-bootstrap-executable-bundle.test.mjs
subst Q: /D
```

- the first long-root attempt failed before compilation because Windows
  rejected the expanded `.vkfbuild` path;
- the identical short-root gate passed 1/1 in 52.82 s; all ten locked compiler
  sources emitted as executables and ran.

`git diff --check` passed with only Git's existing LF-to-CRLF warnings.

## Contract hashes

- ADR 0005 canonical bytes:
  `96A0552F3104475533AFFA66456CDCF9D0F187629865357A1181DB6250CE7BB1`
- bootstrap bundle identity:
  `26D557AEBCD6BB7732527D032ABF5992F9C4EE8CD081021940EFFC83F14F776A`
- bootstrap manifest canonical bytes:
  `3C9ECF74FCC111F5275CDC12E8D64A0D2ADC1EAA7F28B5F7A15B8096C1DA6BFB`
- canonical compiler facade source:
  `9310E3D194027EAE128F643A1E08BF81E3EB7E9D210F2FED326E26B563E285B8`
- I218 acceptance test canonical bytes:
  `349313D7F87D310931C0FEA36CB026A24DFEAE65294D6CAEDBC66615256C3CBC`
- strict Stage-0 seed compiler:
  `C6C450DD729F97F43F35067E7E0D4BE216EBD6059BB4B910BD40BCA89ED85336`
- locked x64 runner template:
  `8B501F0F67A5AA20E33F82DA8B1747E498A09BCE2BC2B4AD576A165CA792D039`

## Gate and performance impact

I218 advances ADR 0005 cutover rule 5's bounded fixed-point subgate: signed
integer addition now passes through the same general byte-arena-backed writer
as unsigned arithmetic, rather than a standalone signed wrapper. It does not
claim full Stage-2/Stage-3 suite equivalence.

Existing callers omit the optional selector and retain their previous parser
and output. Negate-enabled calls add one opcode branch per tape item; emitted
program bytes are exactly the already-proven selectors. No acceptance timeout,
performance threshold, or assertion was weakened, and this packet makes no
frontier performance claim.

Using the eight explicit ADR 0005 cutover rules, rules 1, 2, and 7 are
established; rules 3, 4, and 5 are materially but incompletely implemented;
rules 6 and 8 remain open. Counting each partial rule conservatively as one
half gives `4.5/8 = 56.25%`; the defensible rounded release estimate remains
**55%**, unchanged at whole-percent resolution by this narrow slice.

Remaining fixed-point work includes complete signed numeric integration,
relocations and general artifact encoding, compiling the full locked compiler
graph into Stage 3, running the same complete correctness/diagnostic/package/
native/WASM suite under Stages 2 and 3, stdlib/UI migration, opt-in then removed
C++ fallback, and a seed-only rebuild without C/C++, assembler, linker, Python,
or platform SDK.
