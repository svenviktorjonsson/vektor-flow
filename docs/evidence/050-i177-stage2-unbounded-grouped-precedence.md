# 050-I177 Stage-2 unbounded grouping evidence

## Scope

- Git base: `563bd6fe`
- Consumed packet: uncommitted I176 GREEN contract
- Worktree: `.worktrees/0.5/050-i142-machine-function-list-layout`
- Branch: `codex/0.5/050-i142-machine-function-list-layout`
- State: GREEN, uncommitted for Integration Steward review

I177 adds the already-settled `LPAREN`/`RPAREN` identities `13`/`14` to a
runtime-sized grouped arithmetic path:

```vkf
value: 100
:: (value - (20 + 4) * 2) // (3 + 1)
```

The Stage-0 oracle produces `13`. Without the inner grouping, the value is
`18`; without the outer grouping, it is `88`. The single oracle therefore
proves both nested grouping and precedence override.

The parser emits a private expression token/value tape while retaining the
existing binding-identity checks. It validates operand/operator position and
balanced nested parentheses. Typed IR preserves that private tape. Machine IR
uses a bounded shunting-yard operator stack, retaining the settled precedence
tiers and right-associative power while discarding matched parentheses before
emission. The existing self-hosted stack validator derives the exact maximum
of `3`, which the acceptance test reads from the Stage observation.

Two clean emissions preserve byte-identical PE and provenance receipts.
Replacing the demanded binding inside the nested group with an unknown name is
rejected before replacing either prior output.

No one-field struct syntax, public syntax, precedence rule, API, public
diagnostic, MachineModule version, opcode, receipt schema, numeric type rule,
or ABI changed.

## RED and GREEN receipts

Environment: Windows x64, Node `v24.11.0`, CMake `4.3.0`, MSBuild `16.11.6`.
All spawned processes used hidden windows. No UI or performance workload ran.

RED command:

```powershell
$env:VKF_NATIVE_BIN='J:\build\i150-release-fast\bin\Release'
$env:VKF_TEST_WORK_ROOT='J:\.work'
node --test tests/bootstrap/stage2-unbounded-grouped-precedence-compiler-cli.test.mjs
```

- exit `1`, 0/1 passed in 11.23 s;
- the independent Stage-0 artifact compiled and returned exact stdout `13`;
- intended failure: the Stage-2 compiler facade did not yet own the dynamic
  grouped pipeline;
- consumed source graph bundle:
  `D4DB8C112DA08ADF8F7D4A301A87094278D32ACDE8B5E1B4DA4666B2792C6229`;
- consumed compiler binary:
  `25C820854F57D26585DF56A7E1703FA2F7D6A2C8EAD938468F3B7D1A5A14964E`.

This was a source-only Stage-2 extension; the existing generic dynamic
observation adapter already consumed its Machine-IR tape, so no native rebuild
was required. The first GREEN iteration exposed a self-host source formatting
boundary: a continued assignment emitted an `INDENT` token. Keeping that
private condition on one source line restored the established lexer contract.

GREEN command: the RED command above.

- exit `0`, 1/1 passed in 16.31 s;
- exact Stage-0/Stage-2 stdout match: `13`;
- exact observed stack maximum: `3`;
- two clean emissions were byte-identical;
- an unknown nested binding was atomically rejected.

Differential and robustness command:

```powershell
node --test `
  tests/bootstrap/stage2-unbounded-power-precedence-compiler-cli.test.mjs `
  tests/bootstrap/stage2-unbounded-remainder-precedence-compiler-cli.test.mjs `
  tests/bootstrap/stage2-unbounded-divide-precedence-compiler-cli.test.mjs `
  tests/bootstrap/stage2-unbounded-subtract-precedence-compiler-cli.test.mjs `
  tests/bootstrap/stage2-unbounded-multiply-precedence-compiler-cli.test.mjs `
  tests/bootstrap/stage2-grouped-add-floor-divide-compiler-cli.test.mjs `
  tests/bootstrap/stage1-bootstrap-source-graph.test.mjs `
  tests/bootstrap/stage1-unbounded-machine-ir-validation.test.mjs
```

- exit `0`, 10/10 passed in 25.86 s;
- I172-I176 dynamic precedence paths remained exact;
- the fixed grouped-expression owner remained exact;
- source graph, count-independent validation, and underflow rejection remained
  green.

Locked bundle command:

```powershell
$env:VKF_BOOTSTRAP_FRONTEND_BIN=$env:VKF_NATIVE_BIN
$env:VKF_BUNDLE_ARTIFACT_TOOL=
  'J:\build\i150-release-fast\bin\Release\vkf_bootstrap_bundle_artifact_smoke.exe'
node --test tests/bootstrap/stage1-bootstrap-executable-bundle.test.mjs
```

- exit `0`, 1/1 passed in 32.49 s;
- all ten declared compiler sources emitted as executables and ran
  successfully.

`git diff --check` passed; Git only reported existing LF-to-CRLF conversion
warnings.

## Contract hashes

- ADR 0005 checkout bytes:
  `533D8743CAFB44B19088276DF3A4AE1407FF30D3F58BED5DD16887128DCB7925`
- bootstrap bundle identity:
  `1D21230FD56122547B0CB19B7CB321184D5C2F91096788B29F6D87B9B6920A35`
- bootstrap manifest checkout bytes:
  `602EBBF2FD7E1C514881F1F1E06A7D02EDC9392F1DD0171A752F2AA3D4CD6632`
- canonical parser source:
  `741E98E300C289A625236BF0E4FB0C138EF5586926E62A5A61548904B545CCD1`
- canonical typed-IR source:
  `023CB953AA3E5868F8A0E2858A5D88A6B6770D2CD401B240DA9804A69DDAB19D`
- canonical Machine-IR source:
  `93511FBE9C4848AB09BBAE2A16F7092AFFAA2C4B477ACF0E12DBE5E2E7D368F7`
- canonical Machine-IR validation source:
  `E6F7D6633B56CFB92D9FF595F841C11EEAC59ABE81C469F3A2C95D4FD548EF40`
- canonical compiler facade source:
  `BB34D5C51B2347693E3D69A1B5BC4252CBDEEEB03A0B34292EFD2CACE153C765`
- Stage-2 unbounded grouping acceptance test:
  `F0F551A07BF78080485F7A79821B336DAD480F0A101A6370CFF85B4FF5C8576A`
- internal Stage observation adapter checkout bytes:
  `C95D3CE79AEC712D80FB85AD26B0D034AF062C19D5E8BFE74EE0CFC65B7FF7DF`.

## Acceptance-gate impact

This closes runtime-sized nested grouping and precedence override through
parsing, typed IR, Machine IR, exact stack validation, native consumption, and
emitted execution. Unary minus is now the remaining isolated arithmetic grammar
gap. ADR 0005 cutover rule 5 remains open: Stage 2 cannot rebuild the complete
compiler graph, no Stage-3 compiler exists, and Stage 2 and Stage 3 have not run
the same full suite.

Re-evaluated from I176's 82.6%, 0.5 is conservatively **83.2% total**, **+0.6
percentage points** for this nested-grouping subgate.

## Handoff inventory

I177 adds a private grouped expression tape, typed pass-through, shunting-yard
lowering, compiler facade, one focused test, and this receipt over I162-I176.
Existing dirty files and pre-existing untracked `.work/` content were
preserved. No commit, push, merge, renderer edit, UI launch, public-contract
edit, or generated artifact was added to Git.
