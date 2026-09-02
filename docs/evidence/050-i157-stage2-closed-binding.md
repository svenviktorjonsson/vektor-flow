# 050-I157 Stage-2 closed-binding evidence

## Scope

- Base: `e6f7adc5`
- Worktree: `.worktrees/0.5/050-i142-machine-function-list-layout`
- Branch: `codex/0.5/050-i142-machine-function-list-layout`

I157 extends the Stage-1-built Stage-2 compiler CLI through one printed
expression that consumes an earlier binding:

```vkf
value: 31
:: value + 1
```

The VKF-owned token tape validates the already-supported explicit output form
and projects it into the existing tagged statement storage. Existing typed-IR
binding resolution proves that the expression loads the prior integer binding.
Existing closed Machine-IR lowering constant-propagates the binding into
`push 31`, `push 1`, `add`, `return`; existing target-independent validation
proves maximum stack depth two.

The Stage-2 native executable exits zero with stdout `32`, matching the
independent Stage-0 artifact. Two clean emissions preserve byte-identical PE
and provenance receipts. Replacing the demanded binding with an unknown name
is rejected before replacing either prior output.

The native observation handoff admits the already-existing internal
`machine_ir.closed_binding.typed_module_pipeline` component. No public syntax,
API, diagnostic, MachineModule version, opcode, receipt schema, or ABI changed.

## RED, GREEN, robustness, and differential evidence

- Before the canonical RED, the test fixture was corrected without production
  edits: a bare top-level expression is not observable, so the oracle source
  uses the existing `::` output form; the generated VKF observation remains
  one expression line accepted by the current direct backend.
- RED: with the I156 compiler graph, the new acceptance test reached the
  Stage-1-built compiler CLI but failed before artifact production with
  `machine IR supports direct calls only`; command exited `1`, 0/1 passed, in
  9.48 s.
- GREEN: `node --test`
  `tests/bootstrap/stage2-closed-binding-compiler-cli.test.mjs` passed 1/1 in
  13.81 s. It verifies exact Stage-0 stdout, deterministic clean emission, and
  atomic rejection of an unknown demanded binding.
- adjacent Stage-2 scalar-binding CLI passed 1/1 in 14.83 s;
- existing Stage-1 closed-binding Machine-IR encoding passed 1/1 in 11.05 s;
- bootstrap source graph, canonical hashes, and full ten-unit executable
  bundle passed 3/3 in 35.20 s;
- fresh `vkf_strict` Release rebuild passed;
- `git diff --check` passed;
- all child processes were hidden and no performance workload ran.

Executable tests used
`VKF_NATIVE_BIN=J:\build\i150-release-fast\bin\Release` and short work roots
under `J:\.work`. The bundle test also used that directory for
`VKF_BOOTSTRAP_FRONTEND_BIN` and its
`vkf_bootstrap_bundle_artifact_smoke.exe` as `VKF_BUNDLE_ARTIFACT_TOOL`.

## Contract hashes

- ADR 0005 checkout bytes:
  `533D8743CAFB44B19088276DF3A4AE1407FF30D3F58BED5DD16887128DCB7925`
- bootstrap bundle identity:
  `E5CC89C7E20425EA15EE6C8D33B1FD2C4FF4C59F3154AD85766721D22D21FC74`
- bootstrap manifest checkout bytes:
  `BAA091AE8582BB466C235D2A79EE08D189B01F99DEEA9F22F5C758053F61DBD0`
- canonical parser source:
  `377A4F3F64D47059AFDD1A59466D4F3F789280FBCC50A3B2F0DBAA156FB1BB2C`
- canonical compiler facade source:
  `459626F0B2BC0836545BDCA9A7D02C29728E5C7269F165FE6391D9902BB8B6ED`
- Stage-2 closed-binding tracer checkout bytes:
  `CDAFBCCD8EE7D1911BC014F97F0E23B1B6EC3ADB588AE3DD44C483A05E4EAD53`
- internal Stage observation adapter checkout bytes:
  `E90E3E9834368882CD646ADC9F676FA04AE8B721426B7993CFA18BAE5EB32462`
- fresh Release `vkf-strict.exe`:
  `4E23750A823B930C1D00626D390927933557AB02FFC857C03F85EE69E1EF8547`

## Acceptance-gate impact

This closes the first exact Stage-2 path where explicit output demands an
arithmetic expression over a prior binding, with name resolution, constant
propagation, and invalid-demand rejection. It does not close ADR 0005 cutover
rule 5: Stage 2 still cannot rebuild the complete compiler graph, no Stage-3
compiler exists, and Stage 2 and Stage 3 have not run the same full suite.

Re-evaluated from I156's 75.5%, 0.5 is conservatively **75.9% total**, **+0.4
percentage points** for this closed-binding arithmetic subgate.
