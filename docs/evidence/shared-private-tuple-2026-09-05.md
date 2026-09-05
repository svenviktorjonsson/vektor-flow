# Private tuple execution checkpoint — 2026-09-05

Bounded tuple construction/update/output packet, under Viktor's accepted A
output-only boundary. Not full tuple or language coverage. Root owns integration;
this lane did not stage, commit, push or deploy the packet.

## RED → GREEN

Root's exact source initially failed at tuple lowering. First construction build
then produced `(8, 4)\n[8, 4]\n12\n` exactly, but the complete source next failed
at `update_attr`. A narrow canonical record-update lowering now uses the existing
record setter, evaluating the RHS first and preserving other fields.

The complete native/shared output is now exactly:

```text
(8, 4)
[8, 4]
12
origin
12
```

A separate copy tracer caught alias mutation: after `a:(1,2); b:a; b.0:9`,
the first artifact printed `(9,2)` for both bindings instead of preserving `a`.
Tuple-only copy-on-write fixes that RED. Constructor operands and update RHS
effects retain the native `1\n2\n3\n(3, 2)\n` sequence. Singleton display stays
native `(7.5)`, not an invented trailing-comma display convention.

## Internal contract and legacy compatibility

- Existing value tags 0–5 keep their numeric identities. Tuple is distinct
  private tag 6; it is neither vector tag 4 nor record tag 5. Tuple references
  remain inside WASM. The legacy tag-validity predicate still accepts only 0–5.
- Canonical tuple IR remains unchanged. At the bytecode layer tuple values use
  existing `Dynamic`, avoiding any new public manifest result-type enum.
- Appended `MakeTuple` opcode 82 requires explicitly serialized private version
  3. Tuple-free bytecode still serializes as version 2. A tuple opcode labeled v2
  is rejected; unknown versions remain rejected. Tests cover both round trips
  and exact rejection behavior. No silent v2 reinterpretation occurs.
- Compiler-owned formatting emits tuple parentheses recursively; JavaScript
  still receives only `{kind, stdout, stderr}`. The former unsupported-tuple host
  guard is advanced to exact tuple output plus the same no-value-leak key guard.
- Tuple-free emitted function bodies retain the old local count/instructions.
  Tuple-copy handling is generated only in private tuple-bearing modules;
  existing array semantics are not rewritten by this packet.

## Gates

Shared build: Emscripten 4.0.14, `bash scripts/build-shared-compiler.sh`.
The following assembled gate passes **69/69**, zero skips:

```sh
node --test tests/bootstrap/shared-tuple-execution.test.mjs tests/bootstrap/private-tuple-bytecode.test.mjs tests/bootstrap/shared-host-output-boundary.test.mjs tests/bootstrap/shared-console-parity.test.mjs tests/bootstrap/shared-stdout-formatter.test.mjs tests/bootstrap/shared-scope-execution.test.mjs tests/bootstrap/shared-call-execution.test.mjs tests/bootstrap/shared-variadic-call-execution.test.mjs tests/bootstrap/shared-record-argument-plan.test.mjs tests/bootstrap/shared-default-call-thunk.test.mjs tests/bootstrap/shared-vector-arithmetic.test.mjs tests/bootstrap/shared-list-construction.test.mjs tests/bootstrap/shared-scalar-logic.test.mjs
```

Separate unskipped `shared-stat-execution` plus
`shared-sine-output-determinism` run remains **4/6**, two failures. Named-rest
`capture_named` and exact sine stdout are not fixed or hidden by this packet.
The conditional, allocation-policy, full-suite and complete UI gates remain
independent. No assertion of complete tuple equality, nesting, spread or generic
function coverage is made; the unchanged full suite determines the next RED.

Current artifacts:

- Compiler WASM SHA256:
  `ef5a91b822ebb5ccfbbf751331bec00beb73f45de874c880303447b84a5d2548`.
- Compiler native frontend probe SHA256:
  `14f11d2369fddfd13bd7ff31985524cd08bee05647142667fd84fa23bb89ac4f`.
- Native strict binary remains
  `b6ff2ff165eada50c3ed1abd6b7503633c10a1036973a670ef40453512fee09e`;
  its unchanged full suite passed 451/451 in the preceding cache receipt.
  Tuple regressions additionally compile fresh native executables per source.

`git diff --check` passes. No active build remains. Source/artifact frozen for
root's next full same-suite run; do not conflate that pending gate with 69/69.

## Exact touched paths

`compiler/native/vkf_wasm_value_layout.hpp`,
`compiler/native/vkf_wasm_bytecode.hpp`,
`compiler/native/vkf_wasm_bytecode_lowering.hpp`,
`compiler/native/vkf_wasm_vm_emitter.hpp`,
`compiler/native/vkf_stdout_format.hpp`,
`tests/bootstrap/shared-tuple-execution.test.mjs`,
`tests/bootstrap/private-tuple-bytecode.test.mjs`,
`tests/bootstrap/shared-host-output-boundary.test.mjs`, this receipt.

Production math still uses the previous implementations. The accurate portable
math candidate is separately checkpointed, not integrated by the tuple change.
