# 050-I178 Stage-2 unary-minus evidence

## Scope

- Git base: `563bd6fe`
- Consumed packet: uncommitted I177 GREEN contract
- Worktree: `.worktrees/0.5/050-i142-machine-function-list-layout`
- Branch: `codex/0.5/050-i142-machine-function-list-layout`
- State: GREEN, uncommitted for Integration Steward review

I178 closes the remaining isolated arithmetic-grammar gap in the runtime-sized
grouped expression path. Before editing, three independent Stage-0 probes
established the authoritative behavior:

```text
-2 ^ 2    -> 4
(-2) ^ 2  -> 4
--2       -> 2
```

Thus unary minus binds more tightly than power, and repeated prefix unary minus
is accepted. The acceptance oracle combines all three cases:

```vkf
value: 100
:: value + 10 * (-2 ^ 2) + 3 * ((-2) ^ 2) + --2
```

Stage 0 returns `154`. The grouped parser converts prefix uses of the existing
minus token into private token identity `21`. The shunting-yard lowering gives
that identity precedence `4`, above power's `3`, and emits private opcode
identity `10`. That identity maps to the already-existing native
`NegateF64`; no public token, opcode, syntax, diagnostic, module version,
receipt schema, numeric type, or ABI changed. A unary stack effect consumes and
produces one value, so validation derives the exact maximum stack of `4`.

Two clean Stage-2 emissions produced byte-identical PE artifacts and provenance
receipts. Replacing the demanded binding with an unknown name was rejected
without replacing either prior output.

## RED and GREEN receipts

Environment: Windows x64, Node `v24.11.0`, CMake `4.3.0`, MSBuild `16.11.6`.
All child processes used hidden windows. No UI, browser, renderer, or benchmark
workload ran.

RED command:

```powershell
$env:VKF_NATIVE_BIN='J:\build\i150-release-fast\bin\Release'
$env:VKF_TEST_WORK_ROOT='J:\.work'
node --test `
  tests/bootstrap/stage2-unbounded-unary-precedence-compiler-cli.test.mjs
```

- exit `1`, 0/1 passed in 18.32 s;
- independent Stage-0 artifact compiled and returned exact stdout `154`;
- intended failure: Stage 2 rejected the valid unary source before output.

GREEN build:

```powershell
cmake --build J:\build\i150-release-fast --config Release --target vkf_strict
```

- exit `0`; rebuilt the native observation consumer with `NegateF64` identity
  `10` support.

GREEN command: the RED command above.

- exit `0`, 1/1 passed in 18.95 s;
- exact Stage-0/Stage-2 stdout match: `154`;
- exact observed stack maximum: `4`;
- private opcode tape contained unary opcode identity `10`;
- two clean artifacts and receipts were byte-identical;
- unknown binding was atomically rejected.

Differential command:

```powershell
node --test `
  tests/bootstrap/stage2-unbounded-unary-precedence-compiler-cli.test.mjs `
  tests/bootstrap/stage2-unbounded-grouped-precedence-compiler-cli.test.mjs `
  tests/bootstrap/stage2-unbounded-power-precedence-compiler-cli.test.mjs `
  tests/bootstrap/stage2-unbounded-remainder-precedence-compiler-cli.test.mjs `
  tests/bootstrap/stage2-unbounded-divide-precedence-compiler-cli.test.mjs `
  tests/bootstrap/stage2-unbounded-subtract-precedence-compiler-cli.test.mjs `
  tests/bootstrap/stage2-unbounded-multiply-precedence-compiler-cli.test.mjs `
  tests/bootstrap/stage2-grouped-add-floor-divide-compiler-cli.test.mjs
```

- exit `0`, 8/8 passed in 44.73 s;
- grouping, right-associative power, and every settled arithmetic precedence
  tier remained exact.

Source-graph and stack-validation commands:

```powershell
node --test tests/bootstrap/stage1-bootstrap-source-graph.test.mjs
node --test tests/bootstrap/stage1-unbounded-machine-ir-validation.test.mjs
```

- exit `0`, 2/2 source-graph tests passed in 0.23 s;
- exit `0`, 2/2 stack-validation tests passed in 18.29 s;
- the first concurrent robustness run timed out one 30-second validation child
  under CPU contention; the same test passed in 12.98 s when rerun serially;
- bundle identity was rotated after the source-graph test detected its expected
  stale value.

Locked-bundle command:

```powershell
$env:VKF_BOOTSTRAP_FRONTEND_BIN=$env:VKF_NATIVE_BIN
$env:VKF_BUNDLE_ARTIFACT_TOOL=
  'J:\build\i150-release-fast\bin\Release\vkf_bootstrap_bundle_artifact_smoke.exe'
node --test tests/bootstrap/stage1-bootstrap-executable-bundle.test.mjs
```

- exit `0`, 1/1 passed in 36.64 s;
- all ten declared compiler sources emitted as executables and ran.

`git diff --check` passed; Git reported only existing LF-to-CRLF warnings.

## Contract hashes

- ADR 0005 canonical bytes:
  `96A0552F3104475533AFFA66456CDCF9D0F187629865357A1181DB6250CE7BB1`
- bootstrap bundle identity:
  `E2ABEE17D31E184BDD320E83E65D996409213B4548D97E87E27C88A0DEC0761A`
- bootstrap manifest checkout bytes:
  `6F609F92BA0FFA52E6BC844B491E85C3FAE5A695A8A79D8039CF3127DF44E4BB`
- canonical parser source:
  `4FBF976BEB3EED74313B84F91FBA6F21706EA3CF3CD8A823DB472C8E502446A0`
- canonical typed-IR source:
  `023CB953AA3E5868F8A0E2858A5D88A6B6770D2CD401B240DA9804A69DDAB19D`
- canonical Machine-IR source:
  `0E9BC6A39B34B7CB8BE2AFDFE1D38498905422CDD740B5933A1F2790FC124FA3`
- canonical Machine-IR validation source:
  `C906DD1822EC990E426C7EBD9204D56B6F2AEA01FF262AF780BB78ED9CD174CC`
- canonical compiler facade source:
  `BB34D5C51B2347693E3D69A1B5BC4252CBDEEEB03A0B34292EFD2CACE153C765`
- I178 acceptance test:
  `66D3FCE17D80ADF439306072CF704070CA459E95E1B896F29022AC1EE6EFBD31`
- internal Stage observation adapter checkout bytes:
  `AA26DA2833BC8552AC73522B90255B6B0C2F23D7BAC4022A44E8ECBEA8B26C19`
- rebuilt native compiler binary:
  `BAE0E3CBC38C80120C6FD5186060B788D71ED083DC4A07529F6826AD0DD90F5F`

## Acceptance-gate impact

This closes unary minus, including its precedence relative to power, nested
grouping, repeated prefix use, exact stack validation, native consumption, and
emitted execution. The runtime-sized arithmetic grammar now covers all settled
operators owned by this private Stage-2 facade. ADR 0005 cutover rule 5 remains
open: Stage 2 cannot rebuild the complete compiler graph, no Stage-3 compiler
exists, and Stage 2 and Stage 3 have not run the same full suite.

Re-evaluated from I177's 83.2%, 0.5.0 is conservatively **83.8% total**, **+0.6
percentage points** for this unary-grammar subgate.

## Handoff inventory

I178 adds private prefix-unary parsing/lowering/validation/native consumption,
one focused test, and this evidence receipt over layered I162-I177 state. The
three temporary Stage-0 probe sources were removed. Existing dirty files and
pre-existing untracked `.work/` content remain preserved. No commit, push, or
merge was performed.
