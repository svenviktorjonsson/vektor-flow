# 050-I224 Stage-2 complete-writer signed mixed division evidence

## Scope and behavior

- Git base: `2dc09ba59af6728eaec1e116faecf2a834b1d45b` (I223)
- Worktree: `.worktrees/0.5/050-i224-stage3-signed-mixed-division`
- Branch: `codex/0.5/050-i224-stage3-signed-mixed-division`
- State: GREEN, ready for exact-scope commit

I224 carries an existing unary-negative integer through the typed division
writer after true division changes the left operand to floating representation:

```vkf
value: 8
:: (value / 2) / -----2
```

Stage 0, Stage 2, and Stage 3 print exact `-2`. Stage-2 and Stage-3 program
artifacts are byte-identical. Their selected tape is `push 8`, `push 2`, true
division, `push 2`, five integer negations, float-left-integer division, and
the floating print tail. Stage-2, Stage-3, and Stage-4 compiler artifacts are
byte-identical. Generated Stage-2 source contains neither internal stage
observation nor `process.run_native`.

The private typed-division facade accepts the already-established optional
negate selector and uses the existing grouped parser only when supplied.
Existing callers retain their prior route. No public syntax, semantics, API,
diagnostic, manifest schema, ABI, UI, renderer, or native implementation changed.

## RED and GREEN receipts

Environment: Windows x64, Node `v24.11.0`, CMake `4.3.0`; ignored seed/smoke
binaries came from I223. Tests used `VKF_TEST_WORK_ROOT=C:\w\vf-i224`.

Focused command:

```powershell
$env:VKF_NATIVE_BIN=(Resolve-Path '.work/full-suite-bin').Path
$env:VKF_TEST_WORK_ROOT='C:\w\vf-i224'
node --test tests/bootstrap/stage2-owned-x64-complete-signed-mixed-division-fixed-point.test.mjs
```

- RED: exit `1`, 0/1 in 11.13 s; no overload accepted the private negate
  argument on the typed-division facade.
- GREEN: exit `0`, 1/1 in 20.17 s.

Adjacent matrix (`node --test --test-concurrency=1`) covered the new test,
all eight prior division/floor-division fixed-point files, I223 signed mixed
subtraction, and `stage1-bootstrap-source-graph.test.mjs`:

- exit `0`, 12/12 in 180.24 s.

Locked gates:

```powershell
node --test tests/bootstrap/stage2-locked-source-graph-fixed-point.test.mjs
node --test tests/bootstrap/stage1-bootstrap-executable-bundle.test.mjs
```

- locked Stage-2/3/4 source graph: exit `0`, 1/1 in 18.80 s;
- complete ten-source executable bundle: exit `0`, 1/1 in 45.01 s.

No timeout, assertion, byte-identity oracle, or performance gate was weakened.

## Contract hashes

- ADR 0005 canonical bytes:
  `96A0552F3104475533AFFA66456CDCF9D0F187629865357A1181DB6250CE7BB1`
- bootstrap bundle identity:
  `FCCFC2E3DC1D76A2EC1F572CF4AE694988E9B3A547F599682525ACA7299D5EAD`
- bootstrap manifest canonical bytes:
  `711CA8FBE941AC76FC22D0FC5533FDBEF25EE00AF0A1CE938B3F39961D60111F`
- canonical compiler facade source:
  `B7D1F1F1C5ED7F063F16C2A315278FA48D60E6A0401D6E0D1482965979191AAC`
- I224 acceptance test canonical bytes:
  `560B982922F0046D93F848DEF15A96B34AF3E05DA7112540C3E1CE928A946729`
- strict Stage-0 seed compiler:
  `C6C450DD729F97F43F35067E7E0D4BE216EBD6059BB4B910BD40BCA89ED85336`
- locked x64 runner template:
  `8B501F0F67A5AA20E33F82DA8B1747E498A09BCE2BC2B4AD576A165CA792D039`

## Gate and completion impact

I224 advances ADR 0005 rule 5's bounded fixed-point subgate for signed mixed
division and completes this representative signed mixed seam across the four
basic arithmetic facades. It does not claim full suite equivalence or a
performance improvement; the optional branch is absent for existing callers.

Rules 1, 2, and 7 are established; rules 3, 4, and 5 are partial; rules 6 and
8 remain open. Counting partial rules as one half gives `4.5/8 = 56.25%`, so
the defensible rounded release estimate remains **55%**. Remaining work includes
other real general writer gaps found by public behavior, general relocations and
artifact encoding, full suite equivalence, stdlib/UI migration, fallback
removal, and the seed-only rebuild without C/C++, assembler, linker, Python,
or a platform SDK.
