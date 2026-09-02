# 050-I160 Stage-2 add-subtract evidence

## Scope

- Base: `1f70fe62`
- Worktree: `.worktrees/0.5/050-i142-machine-function-list-layout`
- Branch: `codex/0.5/050-i142-machine-function-list-layout`

I160 extends the Stage-1-built Stage-2 compiler CLI through ordered addition
and subtraction inside a printed expression over an earlier binding:

```vkf
value: 31
:: value + 3 - 1
```

The VKF-owned token tape validates the already-supported explicit output and
mixed-arithmetic shape, including that the output loads the declared binding.
Existing typed-IR and Machine-IR producers emit `push 31`, `push 3`, `add`,
`push 1`, `subtract`, `return`. Existing target-independent validation proves
maximum stack depth two.

The Stage-2 native executable exits zero with stdout `33`, matching the
independent Stage-0 artifact. Two clean emissions preserve byte-identical PE
and provenance receipts. Replacing the demanded binding with an unknown name
is rejected before replacing either prior output.

The native observation handoff admits the already-existing internal
`machine_ir.closed_add_subtract.typed_module_pipeline` component. No public
syntax, evaluation rule, API, diagnostic, MachineModule version, opcode,
receipt schema, or ABI changed.

## RED, GREEN, robustness, and differential evidence

- RED: with the I159 compiler graph, the new acceptance test reached the
  Stage-1-built compiler CLI but failed before artifact production with
  `machine IR supports direct calls only`; command exited `1`, 0/1 passed, in
  8.58 s.
- The first implementation correctly reached the new parser but treated the
  general function token tape's existing hyphen code as the statement tape's
  minus code. A focused checkpoint showed the CLI exiting `3` before lowering.
  Matching the already-established general-tape code `20` fixed the internal
  handoff without changing token or language semantics.
- GREEN: `node --test`
  `tests/bootstrap/stage2-add-subtract-compiler-cli.test.mjs` passed 1/1 in
  9.92 s. It verifies exact Stage-0 stdout, deterministic clean emission, and
  atomic rejection of an unknown demanded binding.
- adjacent Stage-2 add-multiply CLI passed 1/1 in 16.63 s;
- focused Stage-1 subtraction-order differential passed 1/1 in 12.81 s;
- bootstrap source graph, canonical hashes, and full ten-unit executable
  bundle passed 3/3 in 33.56 s;
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
  `87350DDEE08F5CD7487065326C52CC7C58927704D9FA61740EF59E9849E16E94`
- bootstrap manifest checkout bytes:
  `79D17D77CE55EE79F6906BE9881E80C86F23839B81AD7285BAAF52BBD97CB2EA`
- canonical parser source:
  `FBB71F0B8960CAF5DAFAAA3092E6EEF06EB1E1C80E6511468564A59922F59A59`
- canonical compiler facade source:
  `93719AD619CE92A680751163CED2581E5B0BED282D111308E4E7AC1A56A87852`
- Stage-2 add-subtract tracer checkout bytes:
  `3C272B6CE79332E7F9B970BA528AD374F6E93D7F3400DB66B93535370A4BD44A`
- internal Stage observation adapter checkout bytes:
  `D6F41E83D758B7AA58C25E7B19AACFDE489108A41C84D009FB1D0C81083BF26F`
- fresh Release `vkf-strict.exe`:
  `7480D3DF756744F341951147354B601CB3C879AEC72EC0303B38AD156802E3AE`

## Acceptance-gate impact

This closes the first exact Stage-2 subtraction sequence over a demanded prior
binding, while preserving deterministic emission and atomic invalid-name
rejection. It does not close ADR 0005 cutover rule 5: Stage 2 still cannot
rebuild the complete compiler graph, no Stage-3 compiler exists, and Stage 2
and Stage 3 have not run the same full suite.

Re-evaluated from I159's 76.5%, 0.5 is conservatively **76.7% total**, **+0.2
percentage points** for this subtraction-sequencing subgate.
