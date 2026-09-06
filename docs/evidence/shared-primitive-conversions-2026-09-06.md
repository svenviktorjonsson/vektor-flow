# Shared WASM primitive conversions

Date: 2026-09-06

Base: `6c537ae0 feat(wasm): lower reachable program functions`

The unchanged `core/06-primitives.vkf` example now executes through the actual
production inline-worker request path. The compiler lowers one-argument `num`
as the native widening conversion and encodes a constant valid Unicode scalar
for `chr` in the compiler constant pool. Dynamic `chr` remains explicitly
unsupported; JavaScript does not construct strings or decode VKF values.

Exact compiler-formatted stdout is:

```text
true
A
1.5
7
null
```

The focused production-worker tests are 2/2. Full execution smoke moves from
52/87 to 53/87; exact worker acceptance moves from 2/87 to 3/87 (3.45%). The
import-free deployed artifact SHA-256 is
`36da1f64ec2698e43cf1e7de8698d76dafa8440bea6e14d589fd4667e2ddac21`.
The per-source census is
`shared-documentation-execution-primitives-2026-09-06.json`.
