# 050-I130 division-precedence encoding evidence

## Scope

- Base: `e65be26f`
- RED: `7840f33d`
- GREEN: `f1b6b33a`
- Branch: `codex/0.5/050-i130-division`

I130 carries the already-supported division operator and its existing
precedence across the executable Stage-1 tracer:

```vkf
value: 31
value + 6 / 2
```

The self-hosted lexer retains `/`, the bounded parser preserves division before
addition, typed IR retains all operands, and Machine IR emits `push 31`,
`push 6`, `push 2`, `divide`, `add`, `return`. The self-hosted stack validator
accepts the existing `divide_f64` opcode and proves maximum stack depth three
before the private Stage bridge passes the closed zero-parameter v4 module to
the existing x64 encoder. The artifact prints `34`.

No public syntax, API, diagnostic, opcode, Machine-IR schema, or ABI changed.

## TDD and regression evidence

RED failed in the intended self-hosted arithmetic seam. After the VKF-owned
lexer/parser/typed/MIR/validator path was connected, the I129 compiler reached
only the expected unknown I130 private component. GREEN verification with the
fresh isolated I130 compiler:

- established arithmetic tracers plus division precedence: 4/4 passed in
  22.50 s;
- source graph and full dependent tagged lexer/parser/typed-IR/Machine-IR
  ownership chain: 29/29 passed in 35.77 s;
- established numeric, conditional, and loop private encoder pipelines: 9/9
  passed in 26.23 s;
- division executable: exit 0, stdout `34`;
- all child processes hidden; no performance workload or shared benchmark
  root used.

## Deliberate boundary

This bounded tracer covers a prior numeric binding and one mixed expression
with division precedence. Arbitrary expression length, parentheses, unary
operations, floor division and remaining binary operations, expression-valued
bindings, broad grammar/type lowering, the compiler fixed point, stdlib
ownership, and toolchain-free rebuild remain open.

## Merge queue

Preserve I83 -> clean I84 -> I85 -> I86 -> I87 -> I88 -> I89 -> I90 -> I91
-> I92 -> I93 -> I94 -> I95 -> I96 -> I97 -> I98 -> I99 -> I100 -> I101
-> I102 -> I103 -> I104 -> I105 -> I106 -> I107 -> I108 -> I109 -> I110
-> I111 -> I112 -> I113 -> I114 -> I115 -> I116 -> I117 -> I118 -> I119
-> I120 -> I121 -> I122 -> I123 -> I124 -> I125 -> I126 -> I127 -> I128
-> I129 -> I130. I130 commits are `7840f33d`, `f1b6b33a`, then this evidence
commit. Do not merge or reset the original dirty I84 worktree.

## Contract hashes

- canonical `lexer.vkf`:
  `34052F9337CEF1269318417F60D8BA4BB24455EE0822461AECBFCB81BB00CFF5`
- canonical `parser.vkf`:
  `F0E9B1EB79C8DC31773571671E1A3C28243059B68C45C0AE368FBD4438D648D3`
- canonical `typed_ir.vkf`:
  `E932A3BCFF3340708BEBA41AE7926504C997B18090F9758AFDD3447E2045F7B2`
- canonical `machine_ir.vkf`:
  `CEDF24F67E97AF99D4B0A50DB5159043602B6CE43C46BA18CD91037748BA9817`
- canonical `machine_ir_validation.vkf`:
  `4CC8D39922B212CEBD371F6E22547EE6B1A8B9F1E60B481B905BC2740507918F`
- bootstrap bundle identity:
  `550B02E7FA4005C7489EC54E5FC24221BDE03FEE707E52AC056A27C34A5C2F0B`
- bootstrap manifest file:
  `1529244D3F32706709D0EE1C6DB802484ED406199CAC020FDE9A9B12A39D22AA`
- private Stage bridge source:
  `5EE6855B5A88039078DB33C9C6C35AA080F40BF5210661F41BED90F22E1A3B64`
- arithmetic acceptance test:
  `ACD7AF8A2403C34337DD67DFF53AD6BC9B9F1781F3EBC61A51731D52C0832957`
- isolated I130 `vkf-strict.exe`:
  `9D0C8D7DD24D9504BF2FA3CA43A78C5C61CB3DD293948B4CEC8763ECF03AD652`

## Acceptance-gate impact

The executable Stage-1 tracer now preserves an additional existing precedence
class through validation and native encoding. Against release gates, 0.5 is
estimated at **61.3% total**, **+0.8 percentage points** from I129's 60.5%.
