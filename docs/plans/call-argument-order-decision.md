# LD-CALL-ORDER: argument effects

Status: ready for the Integration Steward to present as one `ready-for-human`
decision. No scheduling change is authorized by this packet. The fixed-call
binding extraction is independent and preserves current native behavior.

**Question:** When arguments print or fail, should they run in the order I
write them at the call site?

```vkf
emit(value:num) -> num:
    :: value
    value
combine(x:num, y:num) -> num: x * 10 + y
:: combine(y:emit(2), x:emit(1))
```

- A — Recommended: argument expressions run left to right as written, each
  once. This prints `2`, `1`, then `12`.
- B — Preserve the current native direct-call behavior: bind arguments first,
  then evaluate in parameter order; fixed spreads run before explicit
  arguments. This prints `1`, `2`, then `12`.

Boundary: if the first evaluated argument fails, later arguments do not run.
For example, changing the order can change which failure is reported and
whether a later print happens. Pure calls keep the same returned value;
effectful existing calls may change their output/error order under A.

Reply: **LD-CALL-ORDER: choose A** or **choose B**.

## Evidence for the steward

Read-only probes against the frozen native CLI returned exit code 0:

- The example above prints `1\n2\n12\n`.
- `combine(emit(1), :pair())`, where `pair` prints `2` and returns `[2]`, prints
  `2\n1\n12\n`.
- Defaults depending on earlier parameters (`x=2`, `y=x+1`, `z=y+1`) correctly
  yield `9`; this packet does not change when missing defaults run.

`CONTEXT.md` does not explicitly define argument evaluation order. The direct
native binder places named arguments near
`vkf_machine_ir_lowering.hpp:11815`, evaluates fixed spreads near 11865, and
emits ordinary arguments in parameter order near 12120. The frontend currently
separates positional/named/spread operands near
`vkf_ast_to_ir_smoke.cpp:4020`, losing cross-class ordering in the exported call
shape. Recheck source locations before implementation.

If A is approved, retain authored order during shared frontend lowering and
capture runtime operands once using existing private temporaries before
parameter placement. Native and WASM must use the same normalization. Do not
alter public syntax/schema or blindly normalize compile-time special forms.
