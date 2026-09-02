# 050-I161 Stage-2 add-divide evidence

## Scope

- Base: `29d63a28`
- Worktree: `.worktrees/0.5/050-i142-machine-function-list-layout`
- Branch: `codex/0.5/050-i142-machine-function-list-layout`

I161 extends the Stage-1-built Stage-2 compiler CLI through division precedence
inside a printed expression over an earlier binding:

```vkf
value: 31
:: value + 6 / 2
```

The VKF-owned general token tape now retains the already-supported slash token
with the same internal code used by the established statement tape. The parser
validates the explicit output and mixed-arithmetic shape, including that the
output loads the declared binding. Existing typed-IR and Machine-IR producers
emit `push 31`, `push 6`, `push 2`, `divide`, `add`, `return`. Existing
target-independent validation proves maximum stack depth three.

The Stage-2 native executable exits zero with stdout `34`, matching the
independent Stage-0 artifact. Two clean emissions preserve byte-identical PE
and provenance receipts. Replacing the demanded binding with an unknown name
is rejected before replacing either prior output.

The native observation handoff admits the already-existing internal
`machine_ir.closed_add_divide.typed_module_pipeline` component. No public
syntax, precedence rule, API, diagnostic, MachineModule version, opcode,
receipt schema, or ABI changed.

## RED, GREEN, robustness, and differential evidence

- RED: with the I160 compiler graph, the new acceptance test reached the
  Stage-1-built compiler CLI but failed before artifact production with
  `machine IR supports direct calls only`; command exited `1`, 0/1 passed, in
  8.94 s.
- GREEN: `node --test`
  `tests/bootstrap/stage2-add-divide-compiler-cli.test.mjs` passed 1/1 in
  15.15 s. It verifies exact Stage-0 stdout, deterministic clean emission, and
  atomic rejection of an unknown demanded binding.
- adjacent Stage-2 add-subtract CLI passed 1/1 in 17.03 s;
- focused Stage-1 division-precedence differential passed 1/1 in 13.05 s;
- bootstrap source graph, canonical hashes, and full ten-unit executable
  bundle passed 3/3 in 35.84 s;
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
  `0857AA59F1D3BF4C85CBD2C0941DDD2AC73254DF8B34A94FB8A29BC7B78E8C5E`
- bootstrap manifest checkout bytes:
  `A9EF19ED4E85FC338A040DB3084729BD59DAC395DD9CDB41052561FE6608A6F6`
- canonical lexer source:
  `D7BDF53CECF43B011B0069DFA56BF75482F66E2C170106A0C1014DF89E7A00CB`
- canonical parser source:
  `703BDEAF14BE6A329F13A578DA157FEE1E3375A2FF72A8047CF011E76B6F8B10`
- canonical compiler facade source:
  `6262AE6F7B156BEFB7568B031F970E8AB8CAEF184A0B8F19346DF6E01BD2A127`
- Stage-2 add-divide tracer checkout bytes:
  `DE21893F6E00DC241C1E38B9D097C18F61D921B39D911877DE5C4469361E8BA9`
- internal Stage observation adapter checkout bytes:
  `642517926A858B1A59E34BA79693948CAD95471FB11F81A321E8895A31752A61`
- fresh Release `vkf-strict.exe`:
  `C4ADCD0EE895FE86621A3354C465EB2BEA5B82BE693D58E1CD5F2AFFD228C33A`

## Acceptance-gate impact

This closes the first exact Stage-2 division-precedence output over a demanded
prior binding and connects slash through the general Stage-2 token tape. It
does not close ADR 0005 cutover rule 5: Stage 2 still cannot rebuild the
complete compiler graph, no Stage-3 compiler exists, and Stage 2 and Stage 3
have not run the same full suite.

Re-evaluated from I160's 76.7%, 0.5 is conservatively **77.0% total**, **+0.3
percentage points** for this division-precedence and token-tape subgate.
