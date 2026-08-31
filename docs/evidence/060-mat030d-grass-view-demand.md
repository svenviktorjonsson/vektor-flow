# MAT030D camera-to-grass demand evidence

Date: 2026-08-31

## Packet

- Base: `741e599ae862a079a2dd510cbd262631c80c8db7`
- Branch: `codex/0.6/060-mat030d-grass-view-demand`
- Scope: internal camera/frustum-to-cell demand adapter feeding the deterministic MAT030C grass field.
- Public VKF syntax/API/schema changes: none.
- Owned paths:
  - `web/vf-ui/vf-grass-view-demand.mjs`
  - `tests/js/vf-grass-view-demand.test.mjs`
  - `tests/fixtures/grass-view-demand-smoke.html`
  - `docs/evidence/060-mat030d-grass-view-demand.md`

## Observable contract

- The adapter projects the four camera-frustum corners onto a horizontal grass plane and selects only cells intersecting that convex footprint.
- Cell output is deduplicated, lexicographically canonical, immutable, and directly consumable by `createGrassRendererPacketsReference` without translating identity or material state.
- Demand preserves the MAT030C limits of 4,096 cells and 65,536 blades. A separate 65,536-cell scan cap prevents a large view from enumerating the world.
- Small footprints use exact footprint-versus-cell intersection and nearest-cell selection. Huge footprints traverse bounded square rings around the projected view center and stop at the requested working-set budget.
- Detail is derived from projected cell size and clamped to levels 0 through 4. Moving the camera closer can only append blade detail; established cells, packet IDs, vertices, and indices retain their exact bytes.
- A billion-unit footprint selected 32 nearest cells while scanning no more than 65,536 candidates. It did not allocate or visit an intervening world grid.
- The committed fixture camera selected 128 cells from `[-7, -6]` through `[4, 5]`, detail level `3`, at `0.016817331152239035` world units per pixel. It materialized 1,024 blades in 128 packets: 163,840 vertex bytes and 24,576 index bytes.

## RED to GREEN

1. The first camera-demand test failed because `vf-grass-view-demand.mjs` did not exist. `3afab8d` added frustum projection, exact footprint filtering, canonical selection, and direct MAT030C demand output.
2. The billion-unit view test required observable bounded scanning. `18c7bf6` exposed `scannedCellCount` and proved the large-footprint path stops before the fixed scan cap.
3. `879c49e` pinned view refinement: approaching the same field raises detail while the byte prefix for every shared cell remains unchanged.
4. The capture test failed because no camera-driven renderer fixture existed. `a13ef4e` added a real offscreen fixture that computes demand from its display camera and feeds only those packets to the retained renderer.

## Executable evidence

Affected camera/material/renderer chain:

```text
node --test tests/js/vf-grass-view-demand.test.mjs tests/js/vf-grass-material-field.test.mjs tests/js/vf-conditioned-distribution.test.mjs tests/js/vf-spatial-correlation.test.mjs tests/js/vf-geom-retained-part-identity.test.cjs tests/js/vf-geom-render-evidence.test.cjs
tests 29; pass 29; fail 0
```

Real renderer capture, launched only through the existing Edge `--headless=new` helper:

```text
node tests/helpers/capture_mirror_scene.js tests/fixtures/grass-view-demand-smoke.html tests/fixtures/grass-view-demand-smoke.png 0 9402 grass_view_demand_frame
```

Observed committed-fixture capture evidence:

- WebGPU initialized off-screen at 1,236 x 725 with no initialization, shader, provider, or runtime failures.
- Frame sequence and adapter revision reached `2`; the renderer retained the ground plus exactly 128 camera-demanded grass cell packets.
- The 128 packets contained 1,024 blades in the bounded 188,416-byte geometry working set.
- `captureGeomFrameDataUrl` returned a PNG data URL of length 159,118.
- The transient 119,320-byte PNG had SHA-256 `AA50F863F57E651FC2B8A285DEC2F1D45CCD4B96DD7A1803F8B1977BCB3DD7FC`, was visually checked for a camera-framed grass field, and was removed. No generated binary remains.
- The first capture exposed an inherited zero-light WebGPU binding failure: a 16-byte clustered-light buffer did not meet the shader's 64-byte binding minimum. The fixture retains one ordinary point light until that unrelated renderer contract is repaired; grass packets remain independent of scene lighting.

Repository suite:

```text
npm test
tests 477; pass 474; fail 3
```

The same three inherited integration failures remain outside owned paths:

- generated HTML component catalog is stale;
- symbolic document scope expected `8`, observed `-8`;
- named symbolic function/constant geometry expected `[-5, 625]`, observed `[-5, -624]`.

## Content hashes

| Path | Git blob | working-tree SHA-256 |
| --- | --- | --- |
| `web/vf-ui/vf-grass-view-demand.mjs` | `a560e7705b58cd0c73d6e1722bf720aae54b1b4f` | `E9333DA5918C8BF65AC5918956BF7BE358C014590F5D53E1620DC4897F106D8D` |
| `web/vf-ui/vf-grass-material-field.mjs` | `6c1fb6f14f7057d8350333e0b71700179e15d5e1` | `BDD6314E45CADD2EEB2B76FD0411E4F0FF6DF92B72D46F72F3ED69267ACA0D40` |
| `tests/js/vf-grass-view-demand.test.mjs` | `e3a62d8a79d39e17f5109a0fbc5c041ed3429640` | `6F85CCB7A64DC44D84C873659310C012343FED7ED2A2F2D8C669B1779E9D1B62` |
| `tests/fixtures/grass-view-demand-smoke.html` | `209e306d55f687300069f0a7f116905f56a91ee4` | `33DEC04B7D0D9D08A00019F280D1F950BAD15854509D2D8209DAB853D6E79760` |

## Remaining boundary

The reference adapter currently requires all four corner rays to meet the grass plane in front of the camera. A later internal packet can clip horizon-facing views to a bounded far distance. Runtime coalescing and a dedicated instanced/WGSL blade path also remain separate packets; they can preserve these cell identities and demand caps.

Recovery: drop commits after base `741e599`; no other worktree is required.
