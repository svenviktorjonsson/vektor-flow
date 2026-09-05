# Native stdlib cache precision — 2026-09-05

Private cache-identity fix; public JSON serialization, typed-IR schema, VKF
syntax and diagnostics are unchanged. No commit or push by this lane.

## Cause and preserved evidence

`parse_linked_module` accepted AST cache schema `vkf-stdlib-ast-v1` using only
source SHA and schema. An existing Sep 4 cache predates the exact binary64 JSON
writer and contains `0.414213562373095` instead of `0.41421356237309503`.
The native driver therefore received an already-rounded AST; its current
diagnostics serializer was not the source of the discrepancy. Packaged modules
parse canonical source and avoid this stale native cache.

`tools/audit-native-cache-precision.mjs` compared the same native binary with
the original cached math import and an identical uncached local module copy.
Cached: rounded=true/exact=false. Uncached: exact=true/rounded=false. Both ran
successfully and printed `3`. The original cache remains untouched, SHA256:
`242c9e7bf57f2827b12c83e6d212214aa93af714bad723759bd5bbd31e54f026`.
Raw receipt: `build/native-cache-precision-audit.json`.

ADR 0005 requires canonical semantic IR across targets. Existing
`shared-json-roundtrip` requires parsed binary64 bits to survive transport;
packaged/linker tests require exact canonical equality. Cached data is not a
competing language authority. Source is authoritative (also explicit in the
driver's invalid-cache comment). No public-contract decision is needed to reject
an obsolete private derived cache.

## RED → GREEN

New `tests/bootstrap/native-stdlib-cache-precision.test.mjs` seeds an isolated
source-hash-valid v1 AST containing rounded numeric data. Before the fix it fails
exactly: `native diagnostics reused a rounded v1 AST instead of authoritative source`.

The only production change is the cache identity in
`compiler/native/vkf_driver_artifact_smoke.cpp::parse_linked_module`:
`vkf-stdlib-ast-v2-binary64-roundtrip`, with a comment explaining v1 loss.
The old entry is neither reused nor deleted; current exact AST gets a new key.
The test proves exact native stdout, exact diagnostics, cold/warm equality,
fresh caching, and preservation of the stale entry. Its first warm run hit the
existing executable overwrite guard; each test compilation now uses its own
output path, without changing that guard.

Docker Emscripten 4.0.14, repository `/src`:

```sh
cmake --build build/native-compiler-docker --target vkf-strict -j2
node --test tests/bootstrap/native-stdlib-cache-precision.test.mjs tests/bootstrap/packaged-module-sources.test.mjs tests/bootstrap/shared-module-linker.test.mjs tests/bootstrap/shared-json-roundtrip.test.mjs tests/bootstrap/shared-module-snapshots.test.mjs tests/bootstrap/shared-test-suite.test.mjs tests/bootstrap/shared-stdout-formatter.test.mjs tests/bootstrap/shared-host-output-boundary.test.mjs tests/bootstrap/shared-console-parity.test.mjs
build/native-compiler-docker/bin/vkf-strict -t tests/vkf
```

Affected gates **22/22**, zero skips; native **451/451**.
Native SHA256: `b6ff2ff165eada50c3ed1abd6b7503633c10a1036973a670ef40453512fee09e`.
Shared WASM unchanged:
`095fefccbc86af69d4f41ab739aeb024d2c5052f9d30ed91115d358dfe1ecd33`.

## Integration ownership

Do not stage the whole driver: its existing shared-stack diff contains 803
removed lines and multiple extraction hunks. This packet owns only the old
schema line replaced by its two-line comment and new identity. Root must isolate
that hunk together with the new regression and receipt, or integrate it with the
reviewed foundation. No staging attempted. No active build remains.

## Separate allocation RED (no policy change)

`tests/bootstrap/shared-arena-policy.test.mjs` is an unskipped **0/1 RED** policy
tracer comparing the two existing emitter configurations with identical empty
bytecode. It does not approve a capacity or diagnostic. Raw observations:
`build/arena-policy-test-uHcnC4/observations.json`.

| Existing setting | Arena bytes | Linear-memory bytes | Capacity−1 / capacity | Capacity+1 | 2 MiB request |
| --- | ---: | ---: | --- | --- | --- |
| Default/browser | 1,048,576 | 1,114,112 | succeeds (alignment rounds up) | traps | traps |
| Native symbolic artifact | 67,108,864 | 67,174,400 | succeeds (alignment rounds up) | traps | succeeds |

Failed allocations leave the heap pointer unchanged. Both overflow cases emit
raw `WebAssembly.RuntimeError: unreachable`, not an exact VKF diagnostic.
This is an allocator-level comparison, not proof of full source-program support
or memory usage on every browser. Capacity and diagnostic decisions remain open;
no runtime, manifest, schema, capacity or acceptance gate was changed.
