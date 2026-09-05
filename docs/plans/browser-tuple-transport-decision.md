# Browser tuple values — ready for human

Status: proposed; not approved or implemented.

**Question:** When JavaScript receives a VKF tuple, should it receive a distinct
tuple value it can inspect directly, or keep it as an opaque VKF handle?

```vkf
pair() -> (num,num): (3,4)
```

- **A — distinct tuple value (recommended):** a webpage can inspect the two
  elements while still distinguishing this tuple from the vector `[3,4]`.
- **B — opaque handle:** the webpage passes the tuple back into VKF functions
  to inspect or use it; it does not decode the tuple into a JavaScript value.

Counterexample: `(3,4)` must never silently become the vector `[3,4]`, including
when either is nested inside a record or another tuple.

VKF syntax, indexing, updates, equality, lifting rules and printed output stay
the same under either choice. Tuple programs need a matching updated compiler
and browser adapter; existing scalar/vector/record callers remain compatible.
The implementation owns representation/versioning details after this observable
choice is approved. No existing reserved field or record key is repurposed.

Reply **choose A** or **choose B**.
