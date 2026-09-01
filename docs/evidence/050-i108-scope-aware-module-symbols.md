# 050-I108 scope-aware module-symbol evidence

## Scope

- Base: `eedd1d2`
- RED: `a6d2e0c`
- Implementation: `3487f6e`
- Branch: `codex/0.5/050-i108-scope-aware-symbol-rewrite`

I108 makes linked-module symbol rewriting respect lexical names. Top-level
module functions, type aliases, and bindings remain namespaced. Function
parameters shadow module symbols in their bodies, and block-local bindings are
introduced in source order after their right-hand sides are rewritten. Linked
exported calls and CamelCase type surfaces retain their existing behavior.

This compiler-internal fix changes no public VKF API, syntax, diagnostic,
opcode, Machine-IR schema, or ABI.

## TDD evidence

The RED fixture declares a module function named `span`, then uses `span` as a
function parameter and as a later local binding. Under I107, its body identifier
was rewritten to the module function and compilation failed with:

```text
direct x64 backend unsupported: multiple machine IR outputs require
displayable core values
```

Fresh I108 evidence:

- focused exported-call, parameter-shadow, and local-shadow tracer: passed;
- I107 lexer-to-parser handoff and CamelCase linked type-alias regression:
  passed;
- linked-import fallback, unresolved import, and empty-module regressions:
  passed;
- combined focused set: 5/5 passed in 3.27 s.

The first fallback run reported three infrastructure-only failures because the
fresh short-path build omitted `vkf.exe` and `vkf_cpp_aot_artifact.exe`.
Building those existing targets and rerunning the identical tests produced
5/5 passes. All child processes remained hidden and no performance workload
ran.

## Deliberate boundary

Parameter default expressions are still rewritten under the surrounding scope.
If VKF permits one default to reference an earlier parameter, ordered parameter
default scoping needs its own language-contract-backed slice. I108 does not
change or infer that semantic.

## Merge queue

Preserve I83 -> clean I84 -> I85 -> I86 -> I87 -> I88 -> I89 -> I90 -> I91
-> I92 -> I93 -> I94 -> I95 -> I96 -> I97 -> I98 -> I99 -> I100 -> I101
-> I102 -> I103 -> I104 -> I105 -> I106 -> I107 -> I108. I108 commits are
`a6d2e0c`, `3487f6e`, then this evidence commit. Do not merge or reset the
original dirty I84 worktree.

## Contract hashes

- linker source:
  `1476DBB004E6E4FADC4C1B77435006D4ADAB0FBA49BD7D36B83DD1255FCFD99B`
- I108 acceptance test:
  `AF0537F3DA7ED2E8691FA0DFB531EA7655A8F5CB4585D76D9F951948B2957F94`
- fresh I108 `vkf-strict.exe`:
  `EDF8ECED8C5854FB2F5E14D1BF8CBB1BDD4E044169A9C6DFF2F1EF5252F8CEC8`
- fresh I108 `vkf.exe`:
  `6BA02D18653E0589BA0DF1443B39CB00C12DE81618967586DD1E7901BBE6D774`
- fresh I108 `vkf_x64_artifact.exe`:
  `86B1852201008E72C9EA6D73BE34405469C9B01FF13538066477812E5051A60C`
- fresh I108 `vkf_cpp_aot_artifact.exe`:
  `7EB9510315EA2DA2FE62EEA0E5BE62D2C63935EA9990DD4F8A227029E3D9FC2F`

## Acceptance-gate impact

Linked self-hosted parser execution can now use local names that collide with
its module helpers without corrupting the AST. This removes the known I107
linker blocker. Heterogeneous `Token.value` transport and the first executable
parser operation remain the next frontend gate.
