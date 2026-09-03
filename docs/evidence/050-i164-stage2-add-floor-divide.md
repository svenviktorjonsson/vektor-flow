# 050-I164 Stage-2 add-floor-divide evidence

## Scope

- Git base: `563bd6fe`
- Consumed packet: uncommitted I163 GREEN contract
- Worktree: `.worktrees/0.5/050-i142-machine-function-list-layout`
- Branch: `codex/0.5/050-i142-machine-function-list-layout`
- State: GREEN, uncommitted for Integration Steward review

I164 extends the Stage-1-built Stage-2 compiler CLI through floor-division
precedence inside a printed expression over an earlier binding:

```vkf
value: 31
:: value + 7 // 2
```

The VKF-owned general token tape now retains adjacent slashes as the existing
floor-division token while preserving a single slash as division. The parser
validates the explicit output and mixed-arithmetic shape, including that the
output loads the declared binding. Existing typed-IR and Machine-IR contracts
emit `push 31`, `push 7`, `push 2`, `floor-divide`, `add`, `return` and validate
maximum stack depth three.

The Stage-2 native executable exits zero with stdout `34`, matching the
independent Stage-0 artifact. Two clean emissions preserve byte-identical PE
and provenance receipts. Replacing the demanded binding with an unknown name
is rejected before replacing either prior output.

The native observation handoff admits the internal
`machine_ir.closed_add_floor_divide.typed_module_pipeline` component. No
public syntax, precedence rule, API, diagnostic, MachineModule version,
opcode, receipt schema, or ABI changed.

## RED and GREEN receipts

Environment: Windows x64, Node `v24.11.0`, CMake `4.3.0`, MSBuild `16.11.6`.
All spawned processes used hidden windows. No UI or performance workload ran.

RED command:

```powershell
$env:VKF_NATIVE_BIN='J:\build\i150-release-fast\bin\Release'
$env:VKF_TEST_WORK_ROOT='J:\.work'
node --test tests/bootstrap/stage2-add-floor-divide-compiler-cli.test.mjs
```

- exit `1`, 0/1 passed in 10.46 s;
- intended failure: the Stage-1-built CLI reached the new tracer, but Stage 0
  rejected its missing VKF pipeline with
  `machine IR supports direct calls only`;
- consumed source graph bundle:
  `11B8E6AB38FCC000796C394F2D35CDB8ADCAFB6835591011CC827D07DFB3CD49`;
- consumed compiler binary:
  `C3388254A18E899BDE18DAA7A2F12B59B3020D6A6842CAC2514A65970DF42643`.

The first implementation run remained RED in 11.58 s with
`incompatible aggregate width for binding stop: 6 vs 1`. This isolated a
self-hosted binding-width error in a separate conditional lexer branch. The
implementation was reduced to the established mutable punctuation-token
pattern before the final GREEN run.

GREEN build:

```powershell
cmake --build J:\build\i150-release-fast --config Release --target vkf_strict
```

- exit `0` in 3.93 s after the lexer correction;
- compiler binary:
  `BC73B8EAD0E254717A052642D80F9ADA036B14D2E1663127EC0F694B574285A8`.

GREEN command: the RED command above.

- exit `0`, 1/1 passed in 14.20 s;
- exact Stage-0/Stage-2 stdout match: `34`;
- two clean emissions were byte-identical;
- an unknown demanded binding was atomically rejected.

Differential and robustness command:

```powershell
node --test `
  tests/bootstrap/stage2-add-power-compiler-cli.test.mjs `
  tests/bootstrap/stage1-compiler-tagged-floor-division.test.mjs `
  tests/bootstrap/stage1-bootstrap-source-graph.test.mjs
```

- exit `0`, 4/4 passed in 14.81 s;
- preceding Stage-2 power remained exact;
- the independent Stage-1 floor-division demand-lowering stayed green;
- source ordering and every canonical source/bundle digest stayed green.

Locked bundle command:

```powershell
$env:VKF_BOOTSTRAP_FRONTEND_BIN=$env:VKF_NATIVE_BIN
$env:VKF_BUNDLE_ARTIFACT_TOOL=
  'J:\build\i150-release-fast\bin\Release\vkf_bootstrap_bundle_artifact_smoke.exe'
node --test tests/bootstrap/stage1-bootstrap-executable-bundle.test.mjs
```

- exit `0`, 1/1 passed in 34.55 s;
- all ten declared compiler sources emitted as executables and ran
  successfully.

`git diff --check` passed; Git only reported existing LF-to-CRLF conversion
warnings.

## Contract hashes

- ADR 0005 checkout bytes:
  `533D8743CAFB44B19088276DF3A4AE1407FF30D3F58BED5DD16887128DCB7925`
- bootstrap bundle identity:
  `17924E13846EA633652113CB85945DB1C309288F30DDD767E145B03E9426202A`
- bootstrap manifest checkout bytes:
  `7E37B03907F6A5F00A08A827CA75A2ADAA1CBFD6DF6EF6329BC4B3080BDCCA4D`
- canonical lexer source:
  `E66F475DDFBDF81C7351D4A91A962ECC56B3E61D5364CABDE1AB742B17219804`
- canonical parser source:
  `B4E493D6B3134A07BC5D851D1D56FB01FFCC17EB99344F63F694C8DEBD62D6EA`
- canonical typed-IR source:
  `BA58826DAA7B86C1BA1FCDF7D527BD02F6A660C266C24793FE83D6BEB6410E82`
- canonical Machine-IR source:
  `664F5A3F071241D97CC6B74309393CE16BBBC60DDB8A20C0A037FBB593BE4778`
- canonical compiler facade source:
  `367842C85037641DE1F0110B210ACA8EDD0A7D6B9E081F7B0CAA073D061AC196`
- Stage-2 add-floor-divide acceptance test:
  `BB4FA0B8A3CDFE4112847797186A391DA0A7C90A686174DD91BFF824A2E39324`
- internal Stage observation adapter checkout bytes:
  `306E511915FA8A7AB69A6598561BC27AA4641735B26AB3F0BB9C9EEE889AE44E`

## Acceptance-gate impact

This closes the first exact Stage-2 multi-character floor-division output
over a demanded prior binding and connects adjacent-slash tokenization through
the general Stage-2 token tape. It does not close ADR 0005 cutover rule 5:
Stage 2 still cannot rebuild the complete compiler graph, no Stage-3 compiler
exists, and Stage 2 and Stage 3 have not run the same full suite.

Re-evaluated from I163's 77.4%, 0.5 is conservatively **77.7% total**, **+0.3
percentage points** for this multi-character-token and floor-division subgate.

## Handoff inventory

I164 adds only floor-division lines to the same isolated compiler path family
already owned by I163, plus one focused test and this receipt. Existing dirty
I162/I163 files and pre-existing untracked `.work/` content were preserved.
No commit, push, merge, renderer edit, UI launch, or generated artifact was
added to Git.
