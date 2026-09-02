# 050-I159 Stage-2 add-multiply evidence

## Scope

- Base: `dee55cee`
- Worktree: `.worktrees/0.5/050-i142-machine-function-list-layout`
- Branch: `codex/0.5/050-i142-machine-function-list-layout`

I159 extends the Stage-1-built Stage-2 compiler CLI through multiplication
precedence inside a printed expression over an earlier binding:

```vkf
value: 31
:: value + 1 * 2
```

The VKF-owned token tape validates the already-supported explicit output and
mixed-arithmetic shape, including that the output loads the declared binding.
Existing typed-IR and Machine-IR producers preserve multiplication precedence
and emit `push 31`, `push 1`, `push 2`, `multiply`, `add`, `return`. Existing
target-independent validation proves maximum stack depth three.

The Stage-2 native executable exits zero with stdout `33`, matching the
independent Stage-0 artifact. Two clean emissions preserve byte-identical PE
and provenance receipts. Replacing the demanded binding with an unknown name
is rejected before replacing either prior output.

The native observation handoff admits the already-existing internal
`machine_ir.closed_add_multiply.typed_module_pipeline` component. No public
syntax, precedence rule, API, diagnostic, MachineModule version, opcode,
receipt schema, or ABI changed.

## RED, GREEN, robustness, and differential evidence

- RED: with the I158 compiler graph, the new acceptance test reached the
  Stage-1-built compiler CLI but failed before artifact production with
  `machine IR supports direct calls only`; command exited `1`, 0/1 passed, in
  10.27 s.
- GREEN: `node --test`
  `tests/bootstrap/stage2-add-multiply-compiler-cli.test.mjs` passed 1/1 in
  15.86 s. It verifies exact Stage-0 stdout, deterministic clean emission, and
  atomic rejection of an unknown demanded binding.
- adjacent Stage-2 nested-addition CLI passed 1/1 in 16.07 s;
- focused Stage-1 multiplication-precedence differential passed 1/1 in
  12.98 s;
- bootstrap source graph, canonical hashes, and full ten-unit executable
  bundle passed 3/3 in 32.40 s;
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
  `9A3FE5CDF6FEFAA199B89C57F8341A10D271CF84B95B413FADD098E489FA4FF7`
- bootstrap manifest checkout bytes:
  `848E27E47B83F26B2DC6DAB78F46BF9D8FE3A1506D38F577FCB3A058E5CAB6C4`
- canonical parser source:
  `2682F133005E6EA8BA476EC269FFE35760418BEE5B5939F1683E492B2AD11217`
- canonical compiler facade source:
  `7131DEF0B1E3911833FC8309091B53BE026F22EA8511A0F2D389F3D9AA083ABE`
- Stage-2 add-multiply tracer checkout bytes:
  `1C3C00BEEA688A1E125A70E3F627F53531EA40D5A15C21B2E1BCC81EFCF146B5`
- internal Stage observation adapter checkout bytes:
  `8A2D4829C15B4DB489F87E19CDC51EFB0416C8312601ADC259902C74150C0538`
- fresh Release `vkf-strict.exe`:
  `9091F25C273C1D90FD88A031699FEA0C87FF8EB55A167A516C0D21D13208B65F`

## Acceptance-gate impact

This closes the first exact Stage-2 mixed-precedence output over a demanded
prior binding, while preserving deterministic emission and atomic invalid-name
rejection. It does not close ADR 0005 cutover rule 5: Stage 2 still cannot
rebuild the complete compiler graph, no Stage-3 compiler exists, and Stage 2
and Stage 3 have not run the same full suite.

Re-evaluated from I158's 76.2%, 0.5 is conservatively **76.5% total**, **+0.3
percentage points** for this multiplication-precedence subgate.
