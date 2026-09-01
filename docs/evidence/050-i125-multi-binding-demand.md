# 050-I125 multi-binding demand evidence

## Scope

- Base: `de0a25ac`
- RED: `087e21ae`
- GREEN: `72ee6ca6`
- Branch: `codex/0.5/050-i125-multi-binding-demand`

I125 extends the executable closed-MIR tracer from one binding/expression pair
to an EOF-complete module containing multiple pairs. The internal demand helper
selects the binding immediately preceding the requested expression, checks the
index bounds, reuses the established name/row validation, and sends only that
closed statement to stack validation and encoding.

The acceptance source is existing VKF syntax:

```vkf
unused: 10
unused + 2
value: 31
value + 1
```

The module has four parser rows, but demanding expression row three encodes
only `value + 1`; the unused earlier pair is not materialized in the selected
Machine IR. The emitted executable prints `32`. No public syntax, API,
diagnostic, opcode, schema, or ABI changes.

## TDD evidence

The RED test failed at the missing multi-pair demand operation. GREEN uses the
I124 ownership-correct/private-encoder compiler and verifies:

- source graph plus one-pair and multi-pair encoding: 4/4 passed in 6.41 s;
- full dependent tagged lexer/parser/typed-IR/Machine-IR chain: 20/20 passed
  in 21.34 s;
- selected executable: exit 0, stdout `32`;
- all child processes hidden; no performance workload or shared benchmark
  root used.

## Deliberate boundary

The selected expression currently resolves an adjacent preceding binding.
Lexical lookup across intervening statements, rebinding/shadowing, multiple
operators, and multiple demanded outputs remain later internal tracers. Broad
grammar/type lowering, the compiler fixed point, stdlib ownership, and
toolchain-free rebuild also remain open.

## Merge queue

Preserve I83 -> clean I84 -> I85 -> I86 -> I87 -> I88 -> I89 -> I90 -> I91
-> I92 -> I93 -> I94 -> I95 -> I96 -> I97 -> I98 -> I99 -> I100 -> I101
-> I102 -> I103 -> I104 -> I105 -> I106 -> I107 -> I108 -> I109 -> I110
-> I111 -> I112 -> I113 -> I114 -> I115 -> I116 -> I117 -> I118 -> I119
-> I120 -> I121 -> I122 -> I123 -> I124 -> I125. I125 commits are
`087e21ae`, `72ee6ca6`, then this evidence commit. Do not merge or reset the
original dirty I84 worktree.

## Contract hashes

- canonical `machine_ir.vkf`:
  `7CE1E3FC72AD1AECDC5C059B84DECACE244CA7828EE8DB4D820BDA61A8A81E02`
- bootstrap bundle identity:
  `061E7FFE98736D156B58F094793028760239AF4E41EE6B4403ECD26564EC83A8`
- bootstrap manifest file:
  `E094C7A9B8B52A2EC2E5286C66CC65F6FB699AFF30A6FEB2199874664D30AD4F`
- multi-binding demand acceptance test:
  `F67601899C3DD991B460BDD9C88A90F61B2C16146F2FC4C2C2D563E98959F2D0`
- reused isolated I124 `vkf-strict.exe`:
  `97E1B3B5E4118D63D191DDD40DD4856EBF845E444EFDA058EE1C8F2A326F7169`

## Acceptance-gate impact

The executable Stage-1 tracer is no longer limited to a two-row module: it can
reach EOF over multiple binding/expression pairs and demand a later pair
without encoding earlier unused work. Against release gates, 0.5 is estimated
at **57.0% total**, **+0.5 percentage points** from I124's 56.5%.
