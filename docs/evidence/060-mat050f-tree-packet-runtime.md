# MAT050F bounded tree packet runtime evidence

Date: 2026-09-01

## Packet

- Base: `887fa8f1` (MAT050E).
- Branch: `codex/0.6/060-mat050f-tree-packet-runtime`.
- Scope: private transactional runtime cache for active MAT050E tree packets.
- Public VKF syntax/API/schema/ABI changes: none.
- Shared renderer changes: none.
- Owned paths: `web/vf-ui/vf-tree-packet-runtime.mjs`, `tests/js/vf-tree-packet-runtime.test.mjs`, and this receipt.

## Internal contract

- The runtime applies complete MAT050E packet deltas to a canonical tree-index-ordered active set.
- A declared byte budget bounds active packet-vector memory. A delta that would exceed the budget fails transactionally: the old active set and render count remain unchanged.
- Refining a tree replaces its prior packet instead of accumulating both levels. Removing a tree immediately releases its packet bytes. Unchanged neighboring trees retain exact object identity.
- Renderer notification happens only when the active packet set changes. Steady deltas do no renderer work.
- Runtime receipts expose active packet, primitive, byte, and delta upload counts for internal measurement.
- This is a private reference cache. It does not select public cache controls, renderer ownership, material names, or VKF syntax.

## RED to GREEN

1. `1b399689` pinned bounded active memory, coarse-to-fine replacement, exact neighboring-tree retention, and removal; it failed because the runtime module did not exist.
2. `1675edfa` added transactional delta application, canonical packet order, byte accounting, and change-only render notification.
3. `9517b6c2` pinned atomic over-budget rejection with zero state/render mutation.

## Executable evidence

Focused forest → geometry → demand → material → packet → runtime chain:

```text
tests 18; pass 18; fail 0
```

Pinned two-tree camera/refinement lifecycle:

```text
coarse: packets 2; primitives 4; bytes 284
tree 0 refined: packets 2; primitives 24; bytes 1,704
tree 0 removed: packets 1; primitives 2; bytes 142
over-budget 1,562-byte delta into 1,561-byte budget: rejected atomically
```

The deterministic 24-tree / 256-primitive MAT050E set ran seven timing passes. Each initial pass created and filled 1,024 fresh runtimes; each steady pass applied 16,384 empty-upload deltas to one populated runtime:

```text
active packet bytes 18,176
initial median 0.0083941406 ms/application
steady median 0.0041514282 ms/application
steady upload bytes 0
checksum 2214854656
```

This measures private CPU runtime bookkeeping only; it is not a WebGPU frame-throughput claim.

Hidden WebGPU regression capture used the existing headless Edge helper and unchanged MAT030B oracle:

```text
node tests/helpers/capture_mirror_scene.js tests/fixtures/rock-material-field-smoke.html <transient.png> 0 9466 rock_material_field_frame
```

- WebGPU initialized off-screen at 1,236 x 725 with no initialization or runtime failure.
- `captureGeomFrameDataUrl` returned a PNG data URL of length 77,754.
- Retained rock material buffers remained 144, 96, and 96 bytes.
- The transient 58,298-byte PNG had SHA-256 `20C7B5A2E8B1BA73F2CA56AEB5B22159F3D5F1AA8D07B3AAA5066A5DEC8F0B7A`, exactly preserving the established image oracle, and was removed.

## Content hashes

| Path | Git blob | SHA-256 |
| --- | --- | --- |
| `web/vf-ui/vf-tree-packet-runtime.mjs` | `82f03a371d34cea1c598cccc07d412758cd237e3` | `51086180C3EDD812FA0E5CA87218233386D090EACB27A03E219F04A5D23678F9` |
| `tests/js/vf-tree-packet-runtime.test.mjs` | `8a2ed4430c9247c88848303ab068ce138d072912` | `C675A6085A1C3CBF2B4D9B95CA0B53A0FF697872F1393462D1C2C46851698EB2` |

## Remaining boundary

MAT050F stores only active CPU packet descriptors. A tree that leaves demand releases its bytes and deterministically regenerates when it returns; no dormant GPU cache is claimed. Camera revision coalescing, renderer buffer ownership, tree shadows/picks/translucency, measured species, coherent wood cuts, and public controls remain uncommitted.

A safe next isolated packet can combine MAT050C camera demand with this runtime in a coalescing private controller, without touching the shared renderer.

Recovery: drop commits after base `887fa8f1`; no 0.4 or shared renderer path was touched.
