# 050-I99 executable StringCursor scan evidence

## Scope

- Base: `3dfc7f9027594457cdeaf640f5c17713c47a4bee`
- RED: `b89d225`
- Implementation: `31d582f`
- Runtime-seam record: `cb59495`
- Branch: `codex/0.5/050-i99-string-cursor-scan`

I99 executes the first VKF-authored lexer scan path through the approved
`StringCursor` constructor, EOF property, peek method, and advance method. It
adds direct machine lowering for the existing private UTF-8 EOF, peek, and
advance primitives by composing existing machine operations; no machine-IR
opcode, schema, public API, syntax, ABI, or diagnostic changed.

The identifier tracer recursively consumes `alpha`, emits a token record, and
compares its kind, spelling, line, and column with the canonical lexer oracle.
The same artifact also verifies byte positions 2 and 6 after advancing across
`é` and `🙂`, EOF after the second scalar, and the existing newline line/column
rule.

## TDD evidence

The RED executable test failed in the direct backend with
`unknown direct machine IR call vkf_string_eof`. The implementation lowers
UTF-8 EOF, peek, and scalar-boundary advance into existing string decode,
format, comparison, branch, and stack operations. A second implementation
cycle exposed and fixed the nominal integer layout of cursor byte positions.

Final fresh-tool evidence:

- executable differential scan: 1/1 passed;
- source graph, canonical digests, I98 cursor contracts, Unicode oracle, and
  executable scan: 7/7 passed in 1202.78 ms;
- queue method regression (`tests/vkf/containers.vkf`): 19/19 passed;
- direct strict compile of `compiler/self_hosted/lexer.vkf`: exit 0 in 862 ms;
- emitted lexer artifact execution: exit 0 with no output.

## Merge queue

Preserve I83 -> clean I84 -> I85 -> I86 -> I87 -> I88 -> I89 -> I90 -> I91
-> I92 -> I93 -> I94 -> I95 -> I96 -> I97 -> I98 -> I99. I99 commits are
`b89d225`, `31d582f`, `cb59495`, then this evidence commit. Do not merge or
reset the original dirty I84 worktree.

## Contract hashes

- `vkf_machine_ir_lowering.hpp`:
  `11436DAD37E531CC5EBA02A53846AF78EC1D3F98EFFB49138219923A44B5A30D`
- `lexer.vkf`:
  `ECF1586922C6BF166EF6DFD90893238899272EDE6943DB28D8A48866A46E8C5F`
- bootstrap manifest:
  `F21A526B61D9065CDA2917C6E8E8448E5466BF13279651F1830E2C305700404A`
- executable scan fixture:
  `AC787F31CC2196D451022EB39F83CB5A3B492950163E2855F96B34BF01647BD1`
- executable scan acceptance test:
  `AA8C59B1399958B290B53C49BE2F41B2A482AAB1AE0DE66825D024B89235782C`
- runtime-seam record:
  `ADE8EE0A707D43E001C33A690BFD2B1AAD9F1EA15D37ED59871BE9E24BE4A3E0`
- fresh `vkf-strict.exe`:
  `08BB57B7898F9D263F17971BF56C192AFFD2ECABBA80F2C9AD1DD130C45FB6AA`
- fresh canonical lexer oracle:
  `2DE01D184DB596FCBBC39269D22EF11B439A4784E35BD700D57E6E93A06A58E0`
- emitted lexer artifact:
  `6667A9E1BC05B96872C3212B96927086F6D857E62AF11548A7AAD7265A5182D6`

## Acceptance-gate impact

The self-hosted lexer is no longer only compilable source: one real token scan
now runs in emitted machine code and agrees with the canonical lexer. Scalar
width remains hidden behind one UTF-8 decoder, so the VKF scan cannot split a
multibyte scalar.

This packet deliberately accumulates the identifier spelling while scanning;
the approved `cursor.slice(start, end)` method is still not executable in the
direct backend. The next packet must make that exact method scalar-boundary
safe in emitted code, replace the tracer's accumulated spelling with the
cursor slice, and differentially cover a nonzero start offset before expanding
the producer to whitespace, numbers, or complete token streams.
