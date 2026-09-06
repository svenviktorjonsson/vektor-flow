# Private source-function PE placement

Baseline: bootstrap `427ea78af5ddc57ebb40ea5e44056300dd55930b`.
This packet places the composed exact x64 bodies for real compiler functions
`artifact_result` and `manifest` into the existing compiler-owned `.vkfcod` PE
section. It connects the PE entry RVA to the source-produced `manifest` symbol.
The artifact is deliberately not executed: that non-entry function requires
caller result context and nine borrowed string arguments. This is not a
generated compiler or self-hosting claim.

## RED to GREEN

The first probe failed with the existing diagnostic `direct x64 backend
unsupported: machine IR supports direct calls only`: **0/1**, 9278.8351 ms.
The initial implementation then exposed a typed test-harness boundary: an
unannotated string vector flattened to 256 cells instead of `[str]`. Explicit
`[str] high_bytes` restored the established raw-byte arena contract.

The new PE-private materializer validates code bytes and entry offset, reuses
existing section discovery/growth/materialization, copies the composed bytes,
zero-fills remaining raw capacity, and updates `AddressOfEntryPoint` to the
selected symbol RVA. An independent JavaScript oracle verifies the entire PE
image byte-for-byte, including preserved prefix/suffix/header bytes, exact
section body, padding, raw offsets/sizes, and entry RVA.

GREEN: **1/1**, 11977.7977 ms total.

## Regression and identity

Serial checkpoint: **28/28**, exit 0, 106350.2937 ms. Complete bundle was
11976.0436 ms, focused composition/PE placement 12119.3927 ms, and locked
source-graph fixed point 8729.5861 ms. Separate bundle repeat: **1/1**, exit 0,
11766.9581 ms total (11686.6239 ms test). Timings are receipts, not performance
claims.

Fresh browser compiler output remains byte-identical to archived baseline. No
private helper is exported. No public syntax, semantics, API, schema, ABI,
diagnostic, optimizer policy, timeout, assertion, or fallback changed.

| Identity | SHA-256 |
| --- | --- |
| PE source, canonical LF | `d47df8754231cfb42dc262938d4ec8044c85cc8637315885fd24b5f16eb35d32` |
| Bootstrap manifest, canonical LF | `73f9caca18593b9dac7928826a59c6e085d66f307af4b54115203140cdc612e5` |
| Ordered bundle | `bd8261afc074440edc30dbd7d50d77f6ff6afae00baa0316cb96351fbc10fcae` |
| Focused test, canonical LF | `477b711312f2150661c4acca8c6d7e303e1b0337b3de116297e52361de840d9d` |
| Identical regenerated WASM | `2bb78c97eb9ac347922b69edd4e1808c83597ffb7094c1b7ea9c1da9e028e817` |
| Identical regenerated manifest | `c342e0e1b1500b8d55d7b86e63cdb8f4ef8031257c789cb2416edbec25f6cc41` |

Next boundary: source-produce an actual entry/caller MachineFunction with the
required context and nine string arguments, then execute its generated PE.
Frozen self-copy, source-responsive successor production, generated-compiler
execution, deterministic compiler fixed point, broad parity, fallback removal,
and exact I240 seed remain missing. ADR-0005 stays 60%.
