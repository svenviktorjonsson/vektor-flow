# 050-I96 refined block scope layout evidence

## Scope

- Base: `ca9df051783fae475c9df896dba5a0976e417c57`
- RED: `9852118ef9feab0d600966ce70fbab59708ba7f3`
- Implementation: `3c66500adfd4c6eb4262de2dccd1c9c2ce0c20fa`
- Branch: `codex/0.5/050-i96-lexer-block-layout`

I96 removes the first full-bundle blocker found after I95. Block-expression
result layout inference now uses the existing builder-aware environment, and
that environment includes implicit `scope_identity` record fields. This keeps
the preallocated result slots identical to layouts refined from actual module
bindings. No language syntax, CLI, schema, ABI, or public diagnostic changed.

## Diagnosis and TDD evidence

The original strict compile of `compiler/self_hosted/lexer.vkf` reproduced the
same `machine IR block result layout mismatch` twice. A tagged temporary probe
showed the minimized scanner-state catalog was statically allocated as 56 slots
but lowered to 104 slots after module-binding refinement. A second full-source
probe showed the same root cause for implicit outer fields: 30 predicted slots
versus 174 refined slots. All `[DEBUG-i96-*]` instrumentation was removed.

The RED regression failed 0/1 in 335.22 ms with the exact 56-versus-104
mismatch. After the fix:

- the focused regression passed 1/1 in 1339.02 ms;
- the affected aggregate/cardinality matrix passed 8/8 in 2003.15 ms;
- the complete self-hosted `lexer.vkf` compiled to a PE artifact;
- that lexer artifact executed with exit code zero and no output.

Two initial aggregate-test failures were setup-only because the fresh worktree
did not yet contain `vkf_x64_artifact.exe`; after building that declared helper,
the same tests passed and are not counted as product failures.

## Merge queue

Preserve I83 -> clean I84 -> I85 -> I86 -> I87 -> I88 -> I89 -> I90 -> I91
-> I92 -> I93 -> I94 -> I95 -> I96. I96 commits are `9852118`, `3c66500`, then
this evidence commit. Do not merge or reset the original dirty I84 worktree.

## Contract hashes

- `vkf_machine_ir_lowering.hpp`:
  `A45C612A5B99BF9F78CD495C61A5999774F0EA017E7368B837865164FF0859EF`
- `refined-block-scope-identity.vkf`:
  `29FBCB7DA05A892FE5034435289F681A5302B42B487A179E8F219F3BD312E3CA`
- `stage1-block-scope-identity-layout.test.mjs`:
  `3C7D14AF9F2E044B98DC07A3A915BF27D8FB03B8530E496F2B1B14CA2EA74246`
- built `vkf-strict.exe`:
  `55066DAB634ECB5C8F2E3958FFCB62745DB02937182B616ACDAE75EB8FC720BC`
- emitted `lexer.vkf` artifact:
  `E8EF00F12275BE15E72640C9A0883C2FDD6BB6075B58D5F430FB53601979D43E`

## Acceptance-gate impact

Every compiler-source unit probed by I95 can now pass direct strict
compilation, including the previously blocked lexer. I96 therefore clears the
dependency needed to expand the executable tracer from one compiler unit to
the manifest's ordered bundle. It does not itself claim a Stage-2 fixed point;
I97 must require every declared unit to emit and execute, then expose the next
real integration failure if one remains.
