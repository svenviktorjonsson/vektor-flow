# 050-I228 Stage-2 relocation collection evidence

## Scope and behavior

- Git base: `d001c53fb71c405088d21228dee6e82b48458f1a` (I227)
- Worktree: `.worktrees/0.5/050-i228-stage3-relocation-collection`
- Branch: `codex/0.5/050-i228-stage3-relocation-collection`
- State: GREEN, ready for exact-scope commit

I228 adds the first internal Stage-2 x64 relocation collection spanning two
source-owned function symbols. Two existing numeric-function source forms are
lowered into helpers at offsets 2 and 22. The entry is discovered at offset 42;
its first call origin is offset 49 and its second call origin is offset 60. One
internal two-entry collection resolves both signed `rel32` values against their
corresponding helper targets.

The executable chain calls `twice(21)`, bridges its result into the second
source-defined identity helper, and prints exact `42`. Its initial jump is
`EB 28`; the two calls are `E8 D1 FF FF FF` (displacement `-47`) and
`E8 DA FF FF FF` (displacement `-38`). The caller supplies sources and
immutable instruction fragments, never symbol positions or relocation
displacements.

Stage 0, Stage 2, and Stage 3 print exact `42`. Stage-2 and Stage-3 programs
are byte-identical; Stage-2, Stage-3, and Stage-4 compiler artifacts are
byte-identical. Generated compiler source contains neither internal stage
observation nor `process.run_native`.

This is a bounded fixed-cardinality internal collection, not a public
relocation schema or a general object/container writer. Dynamic symbol tables,
arbitrary function graphs, branches, data relocations, and PE/ELF/Mach-O
writing remain open. No public syntax, semantics, API, diagnostic, manifest
schema, ABI, UI, renderer, or native implementation changed.

## TDD receipts

Environment: Windows x64, Node `v24.11.0`; ignored seed/smoke binaries came
from I227. Tests used `VKF_TEST_WORK_ROOT=C:\w\vf-i228`.

Focused command:

```powershell
$env:VKF_NATIVE_BIN=(Resolve-Path '.work/full-suite-bin').Path
$env:VKF_TEST_WORK_ROOT='C:\w\vf-i228'
node --test tests/bootstrap/stage2-owned-x64-relocation-collection-fixed-point.test.mjs
```

- RED: exit `1`, 0/1 in 17.88 s; the missing private pair writer was rejected
  as `direct x64 backend unsupported: machine IR supports direct calls only`
  before artifact creation.
- During GREEN, a stale intermediate manifest hash failed in 0.80 s. The next
  1.82 s run exposed `unsupported token INDENT`; a direct compiler-source probe
  localized two split diagnostic guards. Matching the established single-line
  guard form compiled directly with `artifact_fallback:false` in 19.25 s.
- GREEN: exit `0`, 1/1 in 22.48 s.

Adjacent matrix (`node --test --test-concurrency=1`) covered the two-symbol
collection, I227 symbol discovery, backward and forward relocation, the
original artifact seam, high-byte imm32, the complete integer writer, and
source/bundle hash checks:

- exit `0`, 9/9 in 157.22 s.

Locked gates:

```powershell
node --test tests/bootstrap/stage2-locked-source-graph-fixed-point.test.mjs
node --test tests/bootstrap/stage1-bootstrap-executable-bundle.test.mjs
```

- locked Stage-2/3/4 source graph: exit `0`, 1/1 in 22.99 s;
- first bundle attempt: exit `1`, 0/1 in 0.72 s, classified as test setup
  because the new ignored bin directory lacked
  `vkf_bootstrap_bundle_artifact_smoke.exe`;
- after copying the complete six-file verified I227 smoke-bin set, the
  unchanged complete ten-source executable bundle passed: exit `0`, 1/1 in
  57.51 s.

No timeout, assertion, byte oracle, or performance gate was weakened. This
correctness packet makes no performance claim.

## Contract hashes

- ADR 0005 canonical bytes:
  `96A0552F3104475533AFFA66456CDCF9D0F187629865357A1181DB6250CE7BB1`
- bootstrap bundle identity:
  `99D35883E8264EB41A380BC645612A8BBBFA9174A1E785B1245055C03C4B0D37`
- bootstrap manifest canonical bytes:
  `A379C15B8614811E1884A7C9434927C942DBECD89621C806C620F7EEFF3D726F`
- canonical compiler facade source:
  `C86666342BE1067F2A2C130E389732DCAB2797018E6026051DC7098560CD8076`
- I228 acceptance test canonical bytes:
  `5984B451DE14CCED4961614AE3848874EFE78EA729036A2F08658373ADCEE27B`
- strict Stage-0 seed compiler:
  `C6C450DD729F97F43F35067E7E0D4BE216EBD6059BB4B910BD40BCA89ED85336`
- locked x64 runner template:
  `8B501F0F67A5AA20E33F82DA8B1747E498A09BCE2BC2B4AD576A165CA792D039`

## Gate and completion impact

I228 advances ADR 0005 rules 3, 4, and 5 by applying one internal collection to
multiple source-owned symbols and call sites. It removes another hard-coded
relocation seam but does not close a whole rule or claim general artifact
writing.

Rules 1, 2, and 7 are established; rules 3, 4, and 5 are partial; rules 6 and
8 remain open. Counting partial rules as one half remains `4.5/8 = 56.25%`,
so the defensible rounded release estimate stays **55%**. The next real RED is
dynamic symbol-table cardinality/application or the earliest general container
encoding prerequisite. Full suite equivalence, stdlib/UI migration, fallback
removal, and the seed-only toolchain-free rebuild remain.
