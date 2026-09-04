# 050-I220 Stage-2 complete-writer floating negation evidence

## Scope

- Git base: `df913c165d887d05313be44c4119b7f863e854e8` (I219)
- Worktree: `.worktrees/0.5/050-i220-stage3-signed-multiplication-writer`
- Branch: `codex/0.5/050-i220-stage3-signed-multiplication-writer`
- State: GREEN, ready for exact-scope commit

I220 carries unary negation through the complete numeric x64 writer after true
division has changed the value representation from integer to floating. The
unchanged public VKF source is:

```vkf
value: 8
:: -----(value / 2)
```

Stage 0, Stage 2, and Stage 3 print exact `-4`. The existing grouped tagged
parser and opcode 10 are unchanged. The complete writer now selects the
integer or floating negation code by its existing representation stack.
Unsigned callers and integer-negation callers retain their previous paths.

The Stage-2 and Stage-3 programs are byte-identical. Their selected code is
`push 8`, `push 2`, integer/integer true division with a floating result, five
exact floating sign-bit toggles, and the floating print tail. The Stage-2,
Stage-3, and Stage-4 compiler artifacts are byte-identical. Generated Stage-2
source contains neither internal stage observation nor `process.run_native`.

No public syntax, semantics, API, diagnostic, manifest schema, ABI, UI,
renderer, or native bootstrap implementation changed.

## RED and GREEN receipts

Environment: Windows x64, Node `v24.11.0`, CMake `4.3.0`. Child processes used
hidden windows. Existing ignored seed and smoke binaries were copied into this
isolated worktree's `.work/full-suite-bin`.

Focused command:

```powershell
$env:VKF_NATIVE_BIN=(Resolve-Path '.work/full-suite-bin').Path
node --test `
  tests/bootstrap/stage2-owned-x64-complete-floating-negation-fixed-point.test.mjs
```

- RED: exit `1`, 0/1 in 9.81 s. Stage 0 reported no matching overload for the
  complete writer's absent private floating-negate argument.
- GREEN: exit `0`, 1/1 in 23.83 s.
- Final focused rerun after preserving the established integer-negation
  diagnostic text: exit `0`, 1/1 in 20.82 s.

Adjacent signed/general writer command used `subst Q:` and
`VKF_TEST_WORK_ROOT=Q:\.work\a`:

```powershell
node --test --test-concurrency=1 `
  tests/bootstrap/stage2-owned-x64-complete-floating-negation-fixed-point.test.mjs `
  tests/bootstrap/stage2-owned-x64-complete-signed-division-fixed-point.test.mjs `
  tests/bootstrap/stage2-owned-x64-complete-signed-addition-fixed-point.test.mjs `
  tests/bootstrap/stage2-owned-x64-signed-multiplication-fixed-point.test.mjs `
  tests/bootstrap/stage2-owned-x64-unary-negation-fixed-point.test.mjs `
  tests/bootstrap/stage2-owned-x64-float-float-division-fixed-point.test.mjs `
  tests/bootstrap/stage1-bootstrap-source-graph.test.mjs
```

- exit `0`, 8/8 in 112.94 s;
- integer negation, signed arithmetic, the division representation transition,
  floating negation, and both canonical source-lock assertions passed.

Locked Stage-2/Stage-3/Stage-4 source graph:

```powershell
$env:VKF_TEST_WORK_ROOT='C:\w\vf-i220'
node --test tests/bootstrap/stage2-locked-source-graph-fixed-point.test.mjs
```

- exit `0`, 1/1 in 16.85 s;
- all ten canonical sources and generated compiler artifacts remain exact
  through Stage 4.

Complete locked compiler bundle:

```powershell
$env:VKF_TEST_WORK_ROOT='C:\w\vf-i220'
node --test tests/bootstrap/stage1-bootstrap-executable-bundle.test.mjs
```

- exit `0`, 1/1 in 46.42 s;
- all ten declared compiler sources emitted as executables and ran.

A prior combined attempt passed the locked graph but the bundle tool
canonicalized the mapped `Q:` path back to this deep checkout and failed to
read source 5/10. The identical bundle passed from the genuine short root;
neither source nor assertions changed.

`git diff --check` passed with only Git's existing LF-to-CRLF warnings.

## Contract hashes

- ADR 0005 canonical bytes:
  `96A0552F3104475533AFFA66456CDCF9D0F187629865357A1181DB6250CE7BB1`
- bootstrap bundle identity:
  `D2FB779A8A5BA66E9D1BACFB139B441463403400627FA39460D3BDD7FB2122D5`
- bootstrap manifest canonical bytes:
  `ADE2518327E26A6CA5FA03CEB876BDB2EC3753C68B60448D72E04FF33FAB38A8`
- canonical compiler facade source:
  `60A5321B8F84F6643F6F32F42C04ECDFE1B8E43EC66E97F3A09C754C47534909`
- I220 acceptance test canonical bytes:
  `AE3648CD84967BA41ADD9E18BAC6AC6E5987BC2E6C139DA116D74552CF1080CA`
- strict Stage-0 seed compiler:
  `C6C450DD729F97F43F35067E7E0D4BE216EBD6059BB4B910BD40BCA89ED85336`
- locked x64 runner template:
  `8B501F0F67A5AA20E33F82DA8B1747E498A09BCE2BC2B4AD576A165CA792D039`

## Gate and performance impact

I220 advances ADR 0005 cutover rule 5's bounded fixed-point subgate: unary
negation now crosses the general writer's first integer-to-floating
representation transition. It does not claim full Stage-2/Stage-3 suite
equivalence.

Existing callers omit the selector and retain their previous parser and
output. Negate-enabled calls perform one representation lookup per unary tape
opcode; emitted program bytes are exact preselected machine code. No timeout,
performance threshold, or assertion was weakened, and this packet makes no
frontier performance claim.

Using the eight explicit ADR 0005 cutover rules, rules 1, 2, and 7 are
established; rules 3, 4, and 5 are materially but incompletely implemented;
rules 6 and 8 remain open. Counting each partial rule conservatively as one
half gives `4.5/8 = 56.25%`; the defensible rounded release estimate remains
**55%**.

Remaining work includes general relocations and artifact encoding, compiling
the full locked compiler graph into Stage 3, running the same complete
correctness, diagnostic, package, native, and WASM suite under Stages 2 and 3,
stdlib/UI migration, opt-in then removed C++ fallback, and a seed-only rebuild
without C/C++, assembler, linker, Python, or a platform SDK.
