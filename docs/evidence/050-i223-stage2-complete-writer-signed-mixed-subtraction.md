# 050-I223 Stage-2 complete-writer signed mixed subtraction evidence

## Scope and behavior

- Git base: `cdbdd81a010c7195ad288ef35b0aafd6e8144ffc` (I222)
- Worktree: `.worktrees/0.5/050-i223-stage3-signed-mixed-subtraction`
- Branch: `codex/0.5/050-i223-stage3-signed-mixed-subtraction`
- State: GREEN, ready for exact-scope commit

I223 carries an existing unary-negative integer through the typed subtraction
writer after true division changes the left operand to floating representation:

```vkf
value: 8
:: (value / 2) - -----3
```

Stage 0, Stage 2, and Stage 3 print exact `7`. The Stage-2 and Stage-3
programs are byte-identical. Their selected tape is `push 8`, `push 2`, true
division, `push 3`, five integer negations, float-left-integer subtraction,
and the floating print tail. Stage-2, Stage-3, and Stage-4 compiler artifacts
are byte-identical. Generated Stage-2 source contains neither internal stage
observation nor `process.run_native`.

The private typed-subtraction facade accepts the already-established optional
negate selector and uses the existing grouped parser only when it is supplied.
Existing callers retain their prior route. No public syntax, semantics, API,
diagnostic, manifest schema, ABI, UI, renderer, or native implementation changed.

## RED and GREEN receipts

Environment: Windows x64, Node `v24.11.0`, CMake `4.3.0`; ignored seed/smoke
binaries came from I222. `VKF_TEST_WORK_ROOT=C:\w\vf-i223` avoided nested
Windows path limits.

Focused command:

```powershell
$env:VKF_NATIVE_BIN=(Resolve-Path '.work/full-suite-bin').Path
$env:VKF_TEST_WORK_ROOT='C:\w\vf-i223'
node --test tests/bootstrap/stage2-owned-x64-complete-signed-mixed-subtraction-fixed-point.test.mjs
```

- RED: exit `1`, 0/1 in 9.21 s; no overload accepted the private negate
  argument on the typed-subtraction facade.
- GREEN: exit `0`, 1/1 in 17.48 s.

Adjacent matrix (`node --test --test-concurrency=1`) covered the new test,
all five prior subtraction fixed-point files, I221 signed mixed addition, I222
signed mixed multiplication, and `stage1-bootstrap-source-graph.test.mjs`:

- exit `0`, 10/10 in 147.20 s.

Locked gates:

```powershell
node --test tests/bootstrap/stage2-locked-source-graph-fixed-point.test.mjs
node --test tests/bootstrap/stage1-bootstrap-executable-bundle.test.mjs
```

- locked Stage-2/3/4 source graph: exit `0`, 1/1 in 16.03 s;
- complete ten-source executable bundle: exit `0`, 1/1 in 47.56 s.

No timeout, assertion, byte-identity oracle, or performance gate was weakened.

## Contract hashes

- ADR 0005 canonical bytes:
  `96A0552F3104475533AFFA66456CDCF9D0F187629865357A1181DB6250CE7BB1`
- bootstrap bundle identity:
  `48A820C6067D90FFD626B13FC307FA020FC704F049BD5D1F0C103CB45083BEF7`
- bootstrap manifest canonical bytes:
  `4B97D9A7E18C7AEFF2CF30ED5106C5D89BC52B52260924B4334F624CF1222DA5`
- canonical compiler facade source:
  `36ED13D13C7C5762CA74C216FC841F56EDF655A72862E753AEF8F1CF10513078`
- I223 acceptance test canonical bytes:
  `5D0EF2C93A82AC723D78CC94A5BDF9076FC952F4F4A863C86A3AA46B69B957C5`
- strict Stage-0 seed compiler:
  `C6C450DD729F97F43F35067E7E0D4BE216EBD6059BB4B910BD40BCA89ED85336`
- locked x64 runner template:
  `8B501F0F67A5AA20E33F82DA8B1747E498A09BCE2BC2B4AD576A165CA792D039`

## Gate and completion impact

I223 advances ADR 0005 rule 5's bounded fixed-point subgate for signed mixed
subtraction. It does not claim full Stage-2/Stage-3 suite equivalence or a
performance improvement; the optional branch is absent for existing callers.

Rules 1, 2, and 7 are established; rules 3, 4, and 5 are partial; rules 6 and
8 remain open. Counting partial rules as one half gives `4.5/8 = 56.25%`, so
the defensible rounded release estimate remains **55%**. Remaining work includes
signed/general division combinations, general relocations/artifact encoding,
full suite equivalence, stdlib/UI migration, fallback removal, and the seed-only
rebuild without C/C++, assembler, linker, Python, or a platform SDK.
