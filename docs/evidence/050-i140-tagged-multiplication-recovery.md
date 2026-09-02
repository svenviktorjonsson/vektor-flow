# 050-I140 tagged-multiplication recovery evidence

## Scope

- Base: `c0c84046`
- RED: `487a57e6`
- GREEN: `31132c5d`
- Branch: `codex/0.5/050-i140-tagged-multiplication-recovery`

I140 extends the existing tagged binary-expression slice through the connected
compiler facade. The already-recognized star token now retains its operator
identity through parser storage and typed IR, lowers to the existing
`multiply_f64` Machine-IR opcode, passes the existing stack validator, and is
observable in the unchanged version-4 `MachineModule` returned by
`compile_tagged_module_statement`.

No public syntax, API, diagnostic, Machine-IR schema, opcode, or ABI changed.

## TDD and regression evidence

RED compiled `value0*2` through `.compiler`, then the produced artifact exited
with status 3 because the previous path emitted the internal unknown operator.
GREEN threads the existing operator through the established self-hosted phases
without a native-backend exception or fallback.

- intentional RED: 0/1 passed in 9.35 s, produced artifact exit status 3;
- focused GREEN: 1/1 passed in 9.17 s, opcode `multiply_f64`;
- source graph, canonical digests, subtraction, tagged parsing, validated
  Machine IR, and multiplication: 6/6 passed in 11.86 s;
- complete locked bootstrap bundle: 10/10 declared units emitted as PE
  executables and ran with exit 0 in 41.25 s;
- `git diff --check` passed;
- all child processes were hidden and no performance workload ran.

The bundle test used a temporary short drive alias mapped to this isolated
worktree to avoid the known Windows path limit. The first two bundle attempts
selected incomplete preserved tool directories and failed before compilation;
the passing run assembled the locked bundle tool and strict compiler in the
isolated temporary work directory. The alias and temporary artifacts were
removed from the active test path after verification; the tool receipt is
preserved under the ignored `build/i140-evidence` directory.

## Recovery notes

The preserved I140 changes in the I139 worktree were read as recovery input
only. This branch reproduced the public RED from the clean I139 commit and
implemented GREEN independently. The dirty I139 worktree was not edited,
reset, staged, or cleaned.

The unfinished I138 full-module-functions RED remains isolated in its own
worktree. It reaches the known heterogeneous aggregate/direct-x64 width seam
when a dynamic list grows from width 1 to the 26-lane `MachineFunction`
record. This packet does not conceal or broaden that seam.

## Merge queue

Preserve I83 through I137, then I139 and this I140 recovery. I140 commits are
`487a57e6`, `31132c5d`, then this evidence commit. Do not merge I138 or reset
the original dirty I84 or I139 worktrees.

## Contract hashes

- canonical `parser.vkf` source:
  `825872501DD1E59EC0676A9EB2C548EEBA797F585A782E9AC6B3E9B05592102A`
- canonical `typed_ir.vkf` source:
  `BE82CE4562ADF0CD664E27CB1C498F273471C38F3F87259CF745E56A5765C0FE`
- canonical `machine_ir.vkf` source:
  `ED803B6EFD7DEFB778A84F90009D45782F0E76944014D2BB35CE943C5B63E945`
- bootstrap bundle identity:
  `AC7B69B040DC9A071B3B8958AA01AE998A3FE615BD38A83398039DC7F3931A9A`
- canonical bootstrap manifest file:
  `D687C6A1B0C3D7F81654691878477984A09F23C677FCD833BB12A3C35EC8A003`
- tagged-multiplication acceptance test:
  `6BD479BF1A79FCDDE6930D0A35D0FACB92F3EE8E44A770E44A3EE006AEA9DFD1`
- reused isolated I135 `vkf-strict.exe`:
  `CF98E81E325541ED6E6EF1CE22A0489230757996027461C16E0E61E95D148AD7`
- reused bootstrap bundle tool:
  `1117890AF150CB2DC8822D07D431D87C568EE92B923BB2557D85EC32EAE31484`

## Acceptance-gate impact

This is one additional Gate-2 frontend identity and Gate-4 lowering slice,
observed through the Gate-3 source-first compiler application. It does not
close a release gate: the full-module aggregate seam and Gate-6 Stage-2 /
Stage-3 fixed point remain open. Re-evaluated from I139, 0.5 therefore remains
**70.1% total**, **+0.0 percentage points**.
