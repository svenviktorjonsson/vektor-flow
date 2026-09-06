# Documentation execution after shared trig integration

Main checkpoint `eeb71263`; shared WASM SHA-256
`63b0f126f2c606dec39240845e660a63aaeb95abe1e6daeb69cf54340acfafc0`.
Unchanged inventory: **45/87 unique sources execute; 42 fail**. Successful
return is only execution smoke, not proof of stdout, graphics, edit/reset
behavior or native parity. Exact locations and diagnostics are preserved in
`shared-documentation-execution-trig-2026-09-05.json`.

| Failure family | Sources | Observed frontier |
| --- | ---: | --- |
| UI runtime | 2 | `Display<2>` and retained `translate` |
| Primitive conversions / complex | 3 | `chr`, `num`, `int` |
| Type / member reflection | 4 | Metatype values |
| String interpolation | 1 | `interpolated_string` |
| Variadics / spreads | 3 | Named capture, literal spread, spread index |
| Runtime storage | 2 | Stress trap; corrupt stdout value tag after indexing |
| Multisets / symbolic | 4 | Multiset expression/return representation |
| First-class functions | 2 | Function values and captures |
| Control flow / errors | 3 | Type pattern, continue, error type |
| Pipe ranges | 2 | Missing range end; runtime element shape |
| Host-dependent stdlib | 5 | Random's linked wall-time helper, time, I/O, system, process |
| Collections layout | 1 | Record field lowering |
| Regex intrinsic | 1 | Wrong generic intrinsic-arity frontier |
| Linear algebra | 2 | `constant` call in linked dot overload |
| Open-record spill | 1 | Statically unresolved record |
| Existing frontend / historical example context | 6 | Import `v`, INDENT/RPAREN/DOT, missing update bindings |

These are diagnostic groupings, not invented missing requirements or permission
to enable browser host access. The six historical/context cases need native
source verification before changing documentation or compiler behavior.

Next bounded RED: the unchanged guide variadic example and all 14 `calls.vkf`
cases. Native guide stdout is `10\n7\n(flag:true, mode:fast)\n`; shared rejects
`capture_named`. Native call-layout order and ownership are the oracle. After
that cluster, return directly to the first `Display<2>` UI example and the
already-proved private UI effect sites. No source or renderer fallback is
allowed. The missing spectral header remains an explicit separate evaluator
build blocker.

```sh
node tools/verify-shared-documentation-execution.mjs --output=docs/evidence/shared-documentation-execution-trig-2026-09-05.json
```
