# 050-I219 Stage-2 complete-writer signed division evidence

## Scope

- Git base: `f9f8d6582166593dd97b46287a36a1364db7498f` (I218)
- Worktree: `.worktrees/0.5/050-i219-stage3-signed-division-writer`
- Branch: `codex/0.5/050-i219-stage3-signed-division-writer`
- State: GREEN, ready for exact-scope commit

I219 moves a unary-negative integer operand through the complete numeric x64
writer and its integer-to-floating division transition. The unchanged public
VKF source is:

```vkf
value: 9
:: value / -----4
```

Stage 0, Stage 2, and Stage 3 print exact `-2.25`. Supplying the new private
negate selector makes the existing complete writer select the already-owned
grouped tagged parser. Calls that omit the optional selector retain the prior
parser and writer path.

The Stage-2 and Stage-3 programs are byte-identical. Their selected code is
`push 9`, `push 4`, five exact integer-negation selectors, integer/integer true
division with a floating result representation, and the established floating
print tail. The Stage-2, Stage-3, and Stage-4 compiler artifacts are also
byte-identical. The generated Stage-2 source contains neither internal stage
observation nor `process.run_native`.

No public syntax, semantics, API, diagnostic, manifest schema, ABI, UI,
renderer, or native bootstrap implementation changed.

## RED and GREEN receipts

Environment: Windows x64, Node `v24.11.0`, CMake `4.3.0`. Child processes used
hidden windows. Ignored seed and smoke binaries were copied into this isolated
worktree's `.work/full-suite-bin`; no integration source was read or changed
during compilation.

Focused command:

```powershell
$env:VKF_NATIVE_BIN=(Resolve-Path '.work/full-suite-bin').Path
node --test `
  tests/bootstrap/stage2-owned-x64-complete-signed-division-fixed-point.test.mjs
```

- RED: exit `1`, 0/1 in 12.52 s. Stage 0 reported no matching overload for
  the complete numeric writer's absent thirteenth `negate_code` argument.
- GREEN: exit `0`, 1/1 in 22.30 s.

Final adjacent command used `subst Q:` and `VKF_TEST_WORK_ROOT=Q:\.work\a`
to avoid the repository path exceeding the Windows nested-build path limit:

```powershell
node --test --test-concurrency=1 `
  tests/bootstrap/stage2-owned-x64-complete-signed-division-fixed-point.test.mjs `
  tests/bootstrap/stage2-owned-x64-complete-signed-addition-fixed-point.test.mjs `
  tests/bootstrap/stage2-owned-x64-float-float-division-fixed-point.test.mjs `
  tests/bootstrap/stage2-owned-x64-integer-float-division-fixed-point.test.mjs `
  tests/bootstrap/stage2-owned-x64-float-integer-division-fixed-point.test.mjs `
  tests/bootstrap/stage2-owned-x64-division-fixed-point.test.mjs `
  tests/bootstrap/stage1-bootstrap-source-graph.test.mjs
```

- exit `0`, 8/8 in 139.44 s;
- the signed complete writer, unsigned division, three mixed/grouped division
  transitions, and both canonical source-lock assertions passed.

The same command under the long checkout path passed 7/8 in 116.70 s; its only
failure was the pre-existing I185 fixture being unable to write the nested
`.vkfbuild/.../x64-manifest.json` path. No behavior assertion failed.

Locked Stage-2/Stage-3/Stage-4 source graph:

```powershell
$env:VKF_TEST_WORK_ROOT='Q:\.work\i219-locked'
node --test tests/bootstrap/stage2-locked-source-graph-fixed-point.test.mjs
```

- exit `0`, 1/1 in 44.07 s;
- all ten canonical sources and the generated compiler artifact remain exact
  through Stage 4.

Complete locked compiler bundle:

```powershell
$env:VKF_TEST_WORK_ROOT='Q:\.work\i219-bundle'
node --test tests/bootstrap/stage1-bootstrap-executable-bundle.test.mjs
```

- exit `0`, 1/1 in 56.27 s;
- all ten declared compiler sources emitted as executables and ran.

The long-root source-graph attempt failed before compilation because Windows
rejected the expanded `.vkfbuild` filename. The first bundle attempt reported
an absent local smoke tool; copying the existing ignored build artifacts into
the isolated worktree resolved it. Neither event required a source change.

`git diff --check` passed with only Git's existing LF-to-CRLF warnings.

## Contract hashes

- ADR 0005 canonical bytes:
  `96A0552F3104475533AFFA66456CDCF9D0F187629865357A1181DB6250CE7BB1`
- bootstrap bundle identity:
  `0E987B24697F4C5B10445370283E8B7EB1D06D27899D145F98F1D7A90887FCA0`
- bootstrap manifest canonical bytes:
  `CC86D2EDF55107442E40FB356B499C89F2DEF041C3BBD63E49CDD533881F0132`
- canonical compiler facade source:
  `BE9BF90830C6AEEB30599B5AD28D71F947E7009EB05D65854A52757A8FCD1341`
- I219 acceptance test canonical bytes:
  `5D05B86C8E8A013348FE51507A841ACE0C3EB2DCCDFB843FD2692E8E59EC5DBF`
- strict Stage-0 seed compiler:
  `C6C450DD729F97F43F35067E7E0D4BE216EBD6059BB4B910BD40BCA89ED85336`
- locked x64 runner template:
  `8B501F0F67A5AA20E33F82DA8B1747E498A09BCE2BC2B4AD576A165CA792D039`

## Gate and performance impact

I219 advances ADR 0005 cutover rule 5's bounded fixed-point subgate: a signed
integer operand now reaches the general writer's true-division representation
transition, rather than stopping at the standalone signed-integer wrappers. It
does not claim full Stage-2/Stage-3 suite equivalence.

Existing callers omit the selector and retain their previous parser and
output. Negate-enabled calls add one tape opcode branch per unary operator;
emitted program bytes are exactly the already-proven selectors. No timeout,
performance threshold, or assertion was weakened, and this packet makes no
frontier performance claim.

Using the eight explicit ADR 0005 cutover rules, rules 1, 2, and 7 are
established; rules 3, 4, and 5 are materially but incompletely implemented;
rules 6 and 8 remain open. Counting each partial rule conservatively as one
half gives `4.5/8 = 56.25%`; the defensible rounded release estimate remains
**55%**, unchanged at whole-percent resolution by this narrow slice.

Remaining fixed-point work includes complete signed/general numeric writer
integration, general relocations and artifact encoding, compiling the full
locked compiler graph into Stage 3, running the same complete correctness,
diagnostic, package, native, and WASM suite under Stages 2 and 3, stdlib/UI
migration, opt-in then removed C++ fallback, and a seed-only rebuild without
C/C++, assembler, linker, Python, or a platform SDK.
