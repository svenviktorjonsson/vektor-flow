# 050-I118 EOF statement-tape evidence

## Scope

- Base: `fb26910`
- Lexer RED: `96c876d`
- Lexer GREEN: `0ac10cf`
- Parser RED: `c46c98f`
- Parser GREEN: `dacfdf1`
- Branch: `codex/0.5/050-i118-eof-statement-tape`

I118 connects the Stage-1 lexer and parser through homogeneous dynamic tapes.
The lexer scans an arbitrary sequence of the current identifier-plus-number
expressions and emits six-number token rows, physical or synthetic NEWLINEs,
and an explicit EOF. The parser consumes those rows until EOF into I117's
dynamic statement storage and returns a typed module result. Individual
`TaggedBinaryOpNode` values are reconstructed on demand, without one/two/three
statement result aliases.

The module boundary passes the owned source string, numeric rows, and count
separately because linked module record types are nominally scoped. This is an
internal compiler handoff and changes no public VKF syntax, API, diagnostic,
opcode, Machine-IR schema, or ABI.

## TDD evidence

The lexer RED failed because `tagged_statement_token_tape` did not exist. Its
GREEN probe lexed 32 source lines into 129 tokens (32 groups of four plus EOF)
and 774 homogeneous numeric cells.

The parser RED then failed because the EOF consumer and typed module accessor
did not exist. Its GREEN probe produced:

```text
module
32
256
value0
1
value31
32
32
9
0
```

Final evidence using the fresh I115 ownership-correct compiler:

- source graph, aggregate ownership, and full dependent tagged lexer/parser
  chain: 14/14 passed in 56.38 s;
- direct strict compile/execution of `lexer.vkf`: exit 0 in 984 ms;
- direct strict compile/execution of `parser.vkf`: exit 0 in 2563 ms.

All child processes remained hidden and no performance workload ran.

## Deliberate boundary

EOF-driven module ingestion is now count-independent for the executable
identifier-plus-number expression tracer. Broader statement forms and operator
precedence still need typed tape encodings before the seed parser can replace
the full bootstrap frontend. Canonical public ModuleNode and diagnostics remain
unchanged.

## Merge queue

Preserve I83 -> clean I84 -> I85 -> I86 -> I87 -> I88 -> I89 -> I90 -> I91
-> I92 -> I93 -> I94 -> I95 -> I96 -> I97 -> I98 -> I99 -> I100 -> I101
-> I102 -> I103 -> I104 -> I105 -> I106 -> I107 -> I108 -> I109 -> I110
-> I111 -> I112 -> I113 -> I114 -> I115 -> I116 -> I117 -> I118. I118
commits are `96c876d`, `0ac10cf`, `c46c98f`, `dacfdf1`, then this evidence
commit. Do not merge or reset the original dirty I84 worktree.

## Contract hashes

Source hashes use canonical LF bytes where stated.

- canonical `lexer.vkf`:
  `0F72F737F4FBA2117ED20E213C0F32DB033A9A0085C70A2005F27E5C7B6167B2`
- canonical `parser.vkf`:
  `E5D7302F7594A55C06A45B816656FCB77E5C57FAEBFADB8083C5CFDDECBEF323`
- bootstrap bundle identity:
  `BF067FD0B8342D15107F8E9379F861DF61CCB4E5DC6D1EE6357EB35A9FC74A77`
- bootstrap manifest file:
  `5B3F336B09A81503BAE1AC1DD83C753C9AB4EAE3B97020CB33D8FFD485C959A5`
- dynamic-token acceptance test:
  `4C53E03A6412CC76BBDA0B3E87E6D5F1C64553680F939767838F70B751CCA943`
- EOF-module acceptance test:
  `0272E76B97C9A296430BE4A11C6AF0C2B9F4F9B8DFCC786D4DA6A6C5BDC78A71`
- fresh I115 `vkf-strict.exe`:
  `19A8697696D4E377082634AE86681D610199C188825A9043028EB3073CBB7A3D`
- directly emitted I118 lexer artifact:
  `E8403652EFF6978E91F89D4A72B0D26F363210398BE35F2EB0F0F8BD4B7D2435`
- directly emitted I118 parser artifact:
  `5D16B7641462F91AFFEAB49C9244230EA6E590777EE28A9F4A9F216840358F30`

## Acceptance-gate impact

The Stage-1 frontend now proves count-independent lexing and parsing through
EOF for its executable expression tracer, with typed node demand and ordered
module storage. Broader grammar coverage, the full parser/frontend, fixed
point, stdlib ownership, and toolchain-free rebuild remain open.
