# 050-I147 full-module function evidence

## Scope

- Base: `65b93be9`
- Worktree: `.worktrees/0.5/050-i142-machine-function-list-layout`
- Branch: `codex/0.5/050-i142-machine-function-list-layout`

I147 recovers the preserved I138 full-module tracer after I146 removed its
dynamic aggregate-width blocker. The existing compiler facade now assembles a
32-statement module with statement 31 as the entry and retains every other
statement as one of 31 non-entry `MachineFunction` records. The runnable
strict artifact observes the entry, logical function count, first function,
and last function at nonzero index 30.

This packet adds acceptance coverage only. I146's internal aggregate-list fix
was already count-independent, so no production implementation changed. The
MachineModule remains version 4 and no syntax, API, diagnostic, opcode,
schema, or ABI changed.

## TDD and regression evidence

The intentional RED is preserved at `7d7e0604` on
`codex/0.5/050-i138-full-module-functions`: before I146, direct lowering
rejected the 26-lane `MachineFunction` dynamic-list growth. I147 strengthens
that recovered tracer by checking both ends of the 31-element function list.

- focused tracer on a cleanly rebuilt strict compiler: 1/1 passed in
  99.22 s; output was `value31`, `31`, `value0`, `value30`;
- focused tracer, I146's two-function tracer, canonical source graph and
  adjacent nested-string aggregate ownership: 5/5 passed in 110.04 s;
- complete locked bootstrap bundle: all ten declared compiler sources emitted
  as PE executables and ran with exit 0 in 58.62 s;
- `git diff --check` passed;
- all child processes were hidden and no performance workload ran.

The focused and adjacent runs used a fresh Debug strict compiler built from
the I146 frontier through a short drive alias with `/bigobj` and a 64 MiB
linker stack. The locked bundle used that fresh frontend and bundle driver
with I146's fresh non-LTCG Release strict compiler; there are no production
changes between I146 and I147.

## Contract hashes

- ADR 0005 checkout bytes:
  `533D8743CAFB44B19088276DF3A4AE1407FF30D3F58BED5DD16887128DCB7925`
- canonical `machine_ir.vkf` Git bytes:
  `6A86DDCD4218F9FC039510E5AA5E4925B95CCDA10286D9849C7991FA22B1D9C7`
- bootstrap bundle identity:
  `DF0D784FD2095257A0E69A5C19CE48E93655980C184EB7A588C058D8994D8D88`
- full-module acceptance tracer checkout bytes:
  `71434ED61FE1C40E42B02BC314E9C417FBC56BCEEB41C595435CD9AAF759499F`
- bootstrap manifest checkout bytes:
  `621064656D38C13963D586591C62EADCFF863BDE1EE04D140AEA38265426205A`
- fresh Debug `vkf-strict.exe`:
  `0B4E8C2EB1EDC31B9842C44CE0914DEFAB8DDCD9D4B07E3ED0C05701C1B3D60C`
- fresh Debug bootstrap bundle driver:
  `F3D3B2BEDA3405DA53216F0BCF9E64FA101CCBF6B4A9C78BA1F98FA2D643FA50`
- fresh I146 non-LTCG Release `vkf-strict.exe`:
  `C8F010BEC0097F68D6843B36DAE265C0D65497AADDB20E251F05EF2B5C3A62DA`

## Acceptance-gate impact

The dynamic `MachineFunction` storage prerequisite is no longer evidenced
only by two elements: it survives the existing 32-statement unbounded compiler
facade all the way to a runnable artifact. This materially strengthens ADR
0005 Gate 4 and removes the preserved I138 blocker from the Stage-1-to-Stage-2
dependency chain, but it does not yet make Stage 1 consume the locked compiler
graph and emit a runnable Stage 2 compiler. Re-evaluated from I146, 0.5 remains
**70.1% total**, **+0.0 percentage points** until a complete release gate
closes.
