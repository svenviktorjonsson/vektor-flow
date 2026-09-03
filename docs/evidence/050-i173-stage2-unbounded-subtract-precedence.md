# 050-I173 Stage-2 unbounded subtraction-precedence evidence

## Scope

- Git base: `563bd6fe`
- Consumed packet: uncommitted I172 GREEN contract
- Worktree: `.worktrees/0.5/050-i142-machine-function-list-layout`
- Branch: `codex/0.5/050-i142-machine-function-list-layout`
- State: GREEN, uncommitted for Integration Steward review

I173 extends the runtime-sized arithmetic parser with the already-settled
low-precedence, left-associative subtraction contract:

```vkf
value: 200
:: value - 12 * 3 // 2 - 40 // 5 + 7 * 2
```

Machine IR now retains a pending low-precedence operator rather than only a
pending addition. A following `+` or `-` first emits the previous pending
operator, so addition and subtraction remain left associative, while `*` and
`//` continue extending the current high-precedence term. Private arithmetic
tape identity `6` selects the existing `SubtractF64` and maps to the existing
binary stack effect. This source lowers to sixteen instructions with validated
maximum stack depth three.

The Stage-2 executable exits zero with stdout `188`, matching the independent
Stage-0 artifact. Right association or premature subtraction produces a
different value. Two clean emissions preserve byte-identical PE and provenance
receipts. Replacing the demanded binding with an unknown name is rejected
before replacing either prior output.

No public syntax, precedence rule, API, diagnostic, MachineModule version,
opcode, receipt schema, or ABI changed.

## RED and GREEN receipts

Environment: Windows x64, Node `v24.11.0`, CMake `4.3.0`, MSBuild `16.11.6`.
All spawned processes used hidden windows. No UI or performance workload ran.

RED command:

```powershell
$env:VKF_NATIVE_BIN='J:\build\i150-release-fast\bin\Release'
$env:VKF_TEST_WORK_ROOT='J:\.work'
node --test tests/bootstrap/stage2-unbounded-subtract-precedence-compiler-cli.test.mjs
```

- exit `1`, 0/1 passed in 14.47 s;
- intended failure: the Stage-2 CLI rejected subtraction in the dynamic mixed
  parser and exited `3` before selecting an artifact;
- consumed source graph bundle:
  `45B1670A73FCB1B85D7B412EC057D9C0785E97EFB3D0F8692694C8980255EAFE`;
- consumed compiler binary:
  `25F090F29A697407CBA4AC6507BC332CDAA7614DC429EBD5F3837F5264E1B3FA`.

GREEN build:

```powershell
cmake --build J:\build\i150-release-fast --config Release --target vkf_strict
```

- exit `0` in 16.72 s;
- final compiler binary:
  `32D02D84E751E8088163FCB66A84BE1EBE042930208442D59D45B006DE43B429`.

The first GREEN run exposed that the numeric-function lexer uses its settled
subtraction token identity `20`, while the separate statement scanner uses
identity `8`. The dynamic parser was corrected to consume identity `20`; no
lexer contract changed.

GREEN command: the RED command above.

- exit `0`, 1/1 passed in 15.73 s;
- exact Stage-0/Stage-2 stdout match: `188`;
- two clean emissions were byte-identical;
- an unknown demanded binding was atomically rejected.

Differential and robustness command:

```powershell
node --test `
  tests/bootstrap/stage2-unbounded-multiply-precedence-compiler-cli.test.mjs `
  tests/bootstrap/stage2-unbounded-mixed-arithmetic-compiler-cli.test.mjs `
  tests/bootstrap/stage2-unbounded-addition-chain-compiler-cli.test.mjs `
  tests/bootstrap/stage2-add-subtract-compiler-cli.test.mjs `
  tests/bootstrap/stage1-bootstrap-source-graph.test.mjs `
  tests/bootstrap/stage1-unbounded-machine-ir-validation.test.mjs
```

- exit `0`, 8/8 passed in 25.43 s;
- I170-I172 dynamic precedence paths remained exact;
- the fixed subtraction owner remained exact;
- source graph, count-independent validation, and underflow rejection remained
  green.

Locked bundle command:

```powershell
$env:VKF_BOOTSTRAP_FRONTEND_BIN=$env:VKF_NATIVE_BIN
$env:VKF_BUNDLE_ARTIFACT_TOOL=
  'J:\build\i150-release-fast\bin\Release\vkf_bootstrap_bundle_artifact_smoke.exe'
node --test tests/bootstrap/stage1-bootstrap-executable-bundle.test.mjs
```

- exit `0`, 1/1 passed in 36.78 s;
- all ten declared compiler sources emitted as executables and ran
  successfully.

`git diff --check` passed; Git only reported existing LF-to-CRLF conversion
warnings.

## Contract hashes

- ADR 0005 checkout bytes:
  `533D8743CAFB44B19088276DF3A4AE1407FF30D3F58BED5DD16887128DCB7925`
- bootstrap bundle identity:
  `88350267EE0FE3AB918D2F77C9000AF24D68DDF583522D29D3281BF33EBE4B65`
- bootstrap manifest checkout bytes:
  `F4303148D263C2CB5B45A42826C308F5E15E170032C53E382F48EEF09FCB7491`
- canonical parser source:
  `5CC2D1589283D0BC79C63A28BF6383EAC7AF0FCB1D309D429872B463A0E65C08`
- canonical Machine-IR source:
  `81E9097AB6ADDC711D9F3AE6EA6A0A34399CFD9395A2CB3D540C81AFE5A54294`
- canonical Machine-IR validation source:
  `B73D500C34F28E0A4820EAA5B20CB8337D67596ACA836F15EA7C4EC99C8BA852`
- Stage-2 unbounded subtraction-precedence acceptance test:
  `7A9E8DCC98A88678D37B78457F6CC8C22BED209F3500438654C7B7AB161D848A`
- internal Stage observation adapter checkout bytes:
  `9483E5D979C1C4C9E50D3E4B75006E6EB2D2A586515254FD6FEE008AFA164F50`.

## Acceptance-gate impact

This closes runtime-sized subtraction precedence and associativity through
parsing, typed IR, dynamic Machine IR, validation, native consumption, and
emitted execution. The dynamic parser still does not cover true division,
remainder, power, unary minus, or grouping, and ADR 0005 cutover rule 5 remains
open: Stage 2 cannot rebuild the complete compiler graph, no Stage-3 compiler
exists, and Stage 2 and Stage 3 have not run the same full suite.

Re-evaluated from I172's 80.9%, 0.5 is conservatively **81.3% total**, **+0.4
percentage points** for this subtraction-precedence subgate.

## Handoff inventory

I173 extends the layered dynamic parser/Machine-IR/validator and private native
observation consumer, plus one focused test and this receipt over I162-I172.
Existing dirty files and pre-existing untracked `.work/` content were
preserved. No commit, push, merge, renderer edit, UI launch, public-contract
edit, or generated artifact was added to Git.
