# 050-I204 Stage-2-owned mixed-multiplication evidence

## Scope

- Git base: `9ee134fa`
- Consumed packet: committed I203 GREEN contract
- Worktree: `.worktrees/0.5/050-i142-machine-function-list-layout`
- Branch: `codex/0.5/050-i142-machine-function-list-layout`
- State: GREEN, ready for exact-scope commit

I204 takes the next private Gate-6 writer boundary after complete typed-stack
addition. Multiplication is the next broadly reused arithmetic family, and the
first settled mixed-representation path is:

```vkf
value: 3
:: value / 4 * 2
```

True division leaves the exact `f64` representation on the private numeric
stack. Multiplication restores that value, converts only the integer right
operand, performs `mulsd`, and pushes the exact floating result bits:

```text
58 F2 48 0F 2A C8             pop/convert integer right to xmm1
58 66 48 0F 6E C0             pop/restore floating left to xmm0
F2 0F 59 C1                   mulsd xmm0, xmm1
66 48 0F 7E C0 50             push exact product bits
```

Stage 2 and Stage 3 print `1.5`, exactly matching Stage 0. Their programs are
byte-identical, as are the Stage-2, Stage-3, and Stage-4 compiler artifacts.
The writer path uses neither `--vkf-internal-stage-observation` nor
`process.run_native`.

The packet intentionally does not infer grouped-expression traversal or the
remaining multiplication representation orders. Those are separate private
writer slices. No public syntax, semantics, API, diagnostics, schema, ABI,
UI, renderer, or native bootstrap implementation changed.

## RED and GREEN receipts

Environment: Windows x64, Node `v24.11.0`, CMake `4.3.0`, MSBuild `16.11.6`.
Every child process used hidden windows.

RED command:

```powershell
$env:VKF_NATIVE_BIN='J:\build\i150-release-fast\bin\Release'
$env:VKF_TEST_WORK_ROOT='J:\.work'
node --test `
  tests/bootstrap/stage2-owned-x64-complete-multiplication-fixed-point.test.mjs
```

- exit `1`, 0/1 passed in 12.04 s;
- intended failure: Stage 0 could not resolve the absent private typed
  multiplication writer entry point;
- the RED prototype also exposed that grouped traversal belongs to a distinct
  compiler path, so the GREEN packet was narrowed to the settled ungrouped
  float-left/integer-right boundary and renamed accordingly.

GREEN command:

```powershell
$env:VKF_NATIVE_BIN='J:\build\i150-release-fast\bin\Release'
$env:VKF_TEST_WORK_ROOT='J:\.work'
node --test `
  tests/bootstrap/stage2-owned-x64-float-integer-multiplication-fixed-point.test.mjs
```

- exit `0`, 1/1 passed in 19.70 s;
- Stage-2 and Stage-3 programs returned exact Stage-0 stdout `1.5`;
- both programs contained the independently assembled byte stream;
- Stage-2/Stage-3 programs were byte-identical;
- Stage-2/Stage-3/Stage-4 compilers were byte-identical.

The 16-test margin suite covered I204, all four settled addition
representation pairs, terminal division, positive `imm64`, the complete
integer writer, compositional integer arithmetic, and locked Stage-2 graph
paths.

- exit `0`, 16/16 passed in 63.05 s.

The broad x64/output/locked-source differential passed 26/26 in 72.49 s.
The locked source-graph and executable-bundle gate passed 3/3 in 51.13 s,
including canonical source and bundle digest validation.

`git diff --check` passed with only existing LF-to-CRLF warnings. Unrelated
dirty files and untracked work remained preserved.

## Contract hashes

- ADR 0005 canonical bytes:
  `96A0552F3104475533AFFA66456CDCF9D0F187629865357A1181DB6250CE7BB1`
- bootstrap bundle identity:
  `D599A563AA0DD7EFE59DBD264C575EED9905A1A2DA87F1CBBF5B279881EAB521`
- bootstrap manifest canonical bytes:
  `670266E297BB76BFEFFCD7B6A764872C3F03EFD870600BFDC3E30CE326A0402F`
- canonical compiler facade source:
  `09C92A72A64304E9E3198AB4F1DCA9092525764E66A00DE5AEEE6243BB517DE7`
- I204 acceptance test canonical bytes:
  `CF39331A18EE9453A1BCDBEDCD93EC59D74871CA6EDE1660C71F200D158BF167`
- locked x64 runner template:
  `A5A11724BFFCEAF9BC0AD22F1F202F3435156D11251C06D7BD56A00222258EB8`

## Acceptance-gate impact

I204 proves the first non-addition arithmetic operation can consume a
fractional typed-stack value through Stage-2-owned native emission at fixed
point. Gate 6 remains open on the reverse and float/float multiplication
orders, other floating arithmetic families, signed dynamic-tape loads,
relocations, byte-arena packaging, and rebuilding the complete locked
compiler graph into Stage 3.

Re-evaluated from I203's 96.8%, 0.5.0 is conservatively **97.0% total**,
**+0.2 percentage points** for mixed-representation multiplication.

## Handoff inventory

I204 adds one private mixed-multiplication selector, rotates compiler and
bundle hashes, adds one fixed-point test, and records this receipt. No push or
merge was performed.
