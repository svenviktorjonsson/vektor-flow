# 050-I146 dynamic MachineFunction storage evidence

## Scope

- Base: `71e8bf39`
- Worktree: `.worktrees/0.5/050-i142-machine-function-list-layout`
- Branch: `codex/0.5/050-i142-machine-function-list-layout`

I146 removes the internal scalar-lane assumption from dynamic-list layout
metadata. The existing public compiler path now retains two non-entry
`MachineFunction` records in `MachineModule.functions`, reports their logical
element count, and projects each record's owned name at a nonzero index.

The heap representation remains the existing owned lane buffer and the
MachineModule version remains 4. No public syntax, API, diagnostic, opcode,
schema, or ABI changed.

## TDD and regression evidence

The public tracer compiled three tagged statements with statement 2 as entry,
then observed the entry name, non-entry count, and both non-entry names.

- initial RED: 0/1 passed; direct lowering rejected
  `module.functions.0.name` because the dynamic list lost its element layout;
- second RED: 0/1 passed; fixed aggregate plus dynamic list inferred `str`,
  which could not coerce to `[MachineFunction]`;
- stride RED: the artifact printed logical length `5.2`, proving that nominal
  ten-lane `any` fields had been used instead of the refined function record;
- focused GREEN: 1/1 passed in 89.44 s on a fresh Debug strict compiler;
  output was `value2`, `2`, `value0`, `value1`;
- canonical source graph, bundle digests, and adjacent nested-string aggregate
  ownership: 3/3 passed in 0.87 s;
- complete locked bootstrap bundle: all ten declared compiler sources emitted
  as PE executables and ran with exit 0 in 52.72 s;
- adjacent tagged floor-division compiler tracer: 1/1 passed in 13.76 s;
- `git diff --check` passed;
- all child processes were hidden and no performance workload ran.

The focused build used MSVC Debug with `/bigobj` and a 64 MiB compiler-process
stack because the unoptimized compiler frontend exceeds the repository's
normal 8 MiB Windows stack. The locked bundle used the fresh I146 frontend,
the fresh I146 non-LTCG Release strict compiler, and the preserved I140 bundle
driver. This mixed tool set keeps the locked run below its 60 s timeout while
ensuring that both the changed frontend type rule and the changed source set
are exercised.

## Contract hashes

- ADR 0005:
  `533D8743CAFB44B19088276DF3A4AE1407FF30D3F58BED5DD16887128DCB7925`
- canonical `machine_ir.vkf` source:
  `6A86DDCD4218F9FC039510E5AA5E4925B95CCDA10286D9849C7991FA22B1D9C7`
- bootstrap bundle identity:
  `DF0D784FD2095257A0E69A5C19CE48E93655980C184EB7A588C058D8994D8D88`
- two-function acceptance tracer:
  `D0FCBF03ECB153C9487A15CA6796A01C77F68708BD6B7693C6AC7D771FF9F3B4`
- bootstrap manifest file:
  `621064656D38C13963D586591C62EADCFF863BDE1EE04D140AEA38265426205A`
- fresh Debug `vkf-strict.exe`:
  `B1F506DD1D7142A3E2FB2F2DAC20D4E22DF3B5A8F4CB789F20469660520DD19A`
- fresh non-LTCG Release `vkf-strict.exe`:
  `C8F010BEC0097F68D6843B36DAE265C0D65497AADDB20E251F05EF2B5C3A62DA`

## Acceptance-gate impact

This closes the first bounded resource-owning dynamic aggregate tracer behind
ADR-0005 Gate 4: more than one non-entry function survives the existing public
compiler path, including a nonzero index and nested owned string. It does not
yet prove the full Stage-1-to-Stage-2 compiler cutover or Stage-2/Stage-3 fixed
point. Re-evaluated from I145, 0.5 remains **70.1% total**, **+0.0 percentage
points** until a complete ADR release gate closes.
