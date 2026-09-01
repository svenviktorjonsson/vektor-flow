# 050-I100 executable StringCursor slice evidence

## Scope

- Base: `68fe9f7476994a898d2afe4d87fab260a0be83dc`
- RED: `5ed986d`
- Implementation: `40fcd75`
- Branch: `codex/0.5/050-i100-string-cursor-slice`

I100 makes the approved `cursor.slice(start, end)` method executable in the
direct machine backend. The self-hosted identifier tracer now starts after a
leading byte, consumes with `cursor.advance()`, and obtains token spelling from
`cursor.slice()` at a nonzero start offset. Its token record agrees with the
canonical lexer at column 2.

The lowering validates numeric range and both UTF-8 scalar boundaries, walks
only complete scalars, and composes existing machine string operations. No
opcode, machine-IR schema, public API, syntax, ABI, or public diagnostic was
added or changed. Cursor slice bounds are now explicitly typed as `int` in the
self-hosted lexer.

## TDD evidence

The RED differential test failed in the direct backend with
`unknown direct machine IR call vkf_utf8_slice`. After implementation, the
emitted tracer returned `alpha` from byte range 1..6, returned `🙂` from byte
range 2..6, and rejected byte range 1..2 inside `é` before producing output.

Final fresh-tool evidence:

- executable differential scan and mid-scalar rejection: 2/2 passed;
- source graph, canonical digests, cursor frontend/oracle contracts, executable
  scan, and slice boundary rejection: 8/8 passed in 775.03 ms;
- queue method regression (`tests/vkf/containers.vkf`): 19/19 passed;
- direct strict compile of `compiler/self_hosted/lexer.vkf`: exit 0 in 298 ms;
- emitted lexer artifact execution: exit 0 with no output.

## Merge queue

Preserve I83 -> clean I84 -> I85 -> I86 -> I87 -> I88 -> I89 -> I90 -> I91
-> I92 -> I93 -> I94 -> I95 -> I96 -> I97 -> I98 -> I99 -> I100. I100
commits are `5ed986d`, `40fcd75`, then this evidence commit. Do not merge or
reset the original dirty I84 worktree.

## Contract hashes

- `vkf_machine_ir_lowering.hpp`:
  `DC1518C41ED2805638A041C25FD5A740D7F8CAEE30EEA2009FD42E82DED92843`
- `lexer.vkf`:
  `859300521C8EA0545679597E5FBD9978796C77F48585A8A7940A429EF2F7BBE1`
- bootstrap manifest:
  `0F1B109417FBE685CF331776ABD74DF8AED4C22D44523C117D85E84692AAEF6F`
- executable scan fixture:
  `3A101A3306A523DD60778B9EA70240A2AF41E98688B4B9E53AD8191CACB77A21`
- executable scan acceptance test:
  `35B6EC901C628579B3D99DFA145C937FCC31C25FAC3858AC8999DDFB101751AE`
- fresh `vkf-strict.exe`:
  `64B5D0669253806D132EE574311CF3612C41C4615292D014F4365673A9F1D422`
- fresh canonical lexer oracle:
  `545C590CF58565D9B3D0FF4B5D24F8D563E651CAA4B6E6DA7B60AD2574299F9E`
- emitted lexer artifact:
  `6EF108ABA2E832866147142CD20297024AD76F953175DCEC4E6C8278AD6F0347`

## Acceptance-gate impact

All approved `StringCursor` observations and operations now execute in emitted
machine code, and the first token scan uses the actual slice contract rather
than a test-only spelling accumulator. This clears the cursor runtime dependency
for a VKF-authored lexer producer.

The current direct slice lowering constructs its result one scalar at a time.
That is suitable for the correctness tracer but has not yet graduated the
documented O(n) long-token performance gate. The next packet should invoke the
real `compiler/self_hosted/lexer.vkf` as a linked module from a producer harness
and move identifier/whitespace scanning into that source; independent
performance work can then replace per-scalar concatenation without changing
the approved public surface.
