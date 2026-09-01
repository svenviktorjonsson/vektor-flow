# 050-I115 fixed-aggregate concat ownership evidence

## Scope

- Base: `a1942ca`
- RED: `09ed89f`
- Fix: `83926b4`
- Branch: `codex/0.5/050-i115-aggregate-concat-ownership`

I115 fixes nested owned resources escaping a function through fixed aggregate
concatenation. Borrowed resource-bearing operands are now made independent
before their flattened values form the concat result.

This corrects an existing operator implementation. It changes no public VKF
API, syntax, diagnostic, opcode, Machine-IR schema, or ABI.

## Reproduction and diagnosis

The minimized call returned a two-item fixed vector of records containing
strings. It compiled successfully and deterministically terminated on Windows
with status `0xC0000374` instead of printing both names.

Three separating probes established the boundary:

- numeric records concatenated through a function: exit 0;
- nested-string records concatenated inline: exit 0;
- plain string vectors concatenated through a function: exit 0;
- nested-string records concatenated through a function: `0xC0000374`.

The confirmed cause was that a fixed aggregate `load` is borrowed, while the
concat expression was treated as a transferring value. Its nested string was
therefore not cloned before the function parameter cleanup released it.

## TDD evidence

Against the I114 compiler, the committed RED test failed with:

```text
status 3221226356
```

With the fresh I115 compiler, the same test passed and printed:

```text
alpha
beta
```

The original parser append was also replayed with
`result.module.body & [expression]`; it compiled, printed `alpha` then `beta`,
and exited 0.

Final gates:

- focused ownership and self-hosting dependency chain: 11/11 passed in 13.47 s;
- fixed-vector VKF suite: 30/30 passed;
- original general parser-append replay: compile 0, run 0.

All child processes remained hidden and no performance workload ran. No debug
instrumentation remains.

## Deliberate boundary

The fix applies only when both `&` operands are non-record fixed aggregates.
It uses the existing independent-value and nested-resource clone machinery;
numeric layouts pay no resource-clone cost. I115 does not change dynamic-list,
record-merge, string, or overloaded `&` behavior.

## Merge queue

Preserve I83 -> clean I84 -> I85 -> I86 -> I87 -> I88 -> I89 -> I90 -> I91
-> I92 -> I93 -> I94 -> I95 -> I96 -> I97 -> I98 -> I99 -> I100 -> I101
-> I102 -> I103 -> I104 -> I105 -> I106 -> I107 -> I108 -> I109 -> I110
-> I111 -> I112 -> I113 -> I114 -> I115. I115 commits are `09ed89f`,
`83926b4`, then this evidence commit. Do not merge or reset the original dirty
I84 worktree.

## Evidence hashes

- `vkf_machine_ir_lowering.hpp`:
  `92524DE2256570899EB9D69E04E57676F2B886893E74BDD85A4D7B2C13F9D71C`
- I115 acceptance test:
  `3BDC6E027D19F50A8EC6A73C4C2D4CBFE35ECFA9C1922963F90415E8D5B75CC5`
- fresh I115 `vkf-strict.exe`:
  `19A8697696D4E377082634AE86681D610199C188825A9043028EB3073CBB7A3D`
- original parser-append replay artifact:
  `B1326260E520D4BD32A16F7D5B2DFAFCC0C665082471573061AC0B2414FD1AF1`

## Acceptance-gate impact

The exact backend ownership prerequisite identified by I114 is closed. General
bounded parser accumulation can now use fixed aggregate concatenation without
heap corruption. The parser still needs a follow-up packet to adopt that path,
and general statement iteration, the full parser/frontend, fixed point, stdlib
ownership, and toolchain-free rebuild remain open.
