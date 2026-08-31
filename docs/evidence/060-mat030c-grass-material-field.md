# MAT030C demand-refined grass material evidence

Date: 2026-08-31

## Packet

- Base: `89f8b36f75666198d19ec38249139b7a3afdd341`
- Branch: `codex/0.6/060-mat030c-grass-material-field`
- Scope: internal deterministic multiscale grass field and bounded retained-renderer blade packets.
- Public VKF syntax/API/schema changes: none.
- Owned paths:
  - `web/vf-ui/vf-grass-material-field.mjs`
  - `tests/js/vf-grass-material-field.test.mjs`
  - `tests/fixtures/grass-material-field-smoke.html`
  - `docs/evidence/060-mat030c-grass-material-field.md`

## Observable contract

- One immutable conditioned identity drives field-scale variation, local patch variation, filtered blade-surface variation, and per-blade traits. The pinned sample at `[3.25, -1.5]` has field variation `0.8275767911476568`, patch variation `-0.5268860254969965`, surface variation `-0.2157097563439967`, coverage `0.8093782915027848`, and blade height `0.495709104276328`.
- The field evaluates no more than six spatial octaves per query. It does not allocate a world grid, texture, or unrealized blade population.
- Callers pass only demanded integer cells. Demand is deduplicated and canonicalized before generation, capped at 4,096 cells and 65,536 blades, and represented as interleaved `Float32Array` vertices plus `Uint32Array` indices.
- One blade occupies exactly 184 upload bytes: four 10-float vertices and six u32 indices. Empty demand allocates no packets. A cell at `[2000000000, -2000000000]` materializes directly without visiting intervening cells.
- Cell identity and every established blade are byte-stable across refinement. Raising detail appends counter-addressed blades and never changes the cell packet ID, earlier vertices, or earlier indices.
- The 81-cell capture fixture materializes exactly 1,296 blades in 81 retained packets: 207,360 vertex bytes and 31,104 index bytes. Field, patch, and individual-blade traits jointly affect height, lean, orientation, width, and color.

## RED to GREEN

1. The first test failed because `vf-grass-material-field.mjs` did not exist. `04fe621` added the deterministic three-level field and bounded six-octave filtering.
2. The demanded packet test failed because no renderer-packet export existed. `f743ab1` added canonical cell demand and typed blade geometry under an explicit budget.
3. The capture contract failed because no grass fixture existed. `0dde877` added the real retained-renderer fixture and selected generated base color independently of external scene lighting.
4. The refinement test exposed changing `:lod:` packet IDs and changing established blade vertices. `b80d914` made cell IDs stable and confined refinement to appended blades.
5. `0dbb36a` pinned the numerical oracle and proved direct distant demand, zero allocation for an empty budget, and hard working-set caps.

## Executable evidence

Focused grass suite:

```text
node --test tests/js/vf-grass-material-field.test.mjs
tests 5; pass 5; fail 0
```

Affected deterministic field/material/renderer chain:

```text
node --test tests/js/vf-grass-material-field.test.mjs tests/js/vf-conditioned-distribution.test.mjs tests/js/vf-spatial-correlation.test.mjs tests/js/vf-rock-material-field.test.mjs tests/js/vf-rock-material-gpu.test.mjs tests/js/vf-display-rock-material-pass-through.test.cjs tests/js/vf-geom-retained-part-identity.test.cjs tests/js/vf-geom-render-evidence.test.cjs
tests 37; pass 37; fail 0
```

Real renderer capture, launched only through the existing Edge `--headless=new` helper:

```text
node tests/helpers/capture_mirror_scene.js tests/fixtures/grass-material-field-smoke.html tests/fixtures/grass-material-field-smoke.png 0 9400 grass_material_field_frame
```

Observed committed-head capture evidence:

- WebGPU initialized off-screen at 1236 x 725 with no initialization, shader, provider, or runtime failures.
- Frame sequence and adapter revision reached `2`; the renderer retained the ground plus exactly 81 grass cell packets.
- All 81 grass parts contained 640 vertex values and 96 indices, matching 16 blades per cell.
- `captureGeomFrameDataUrl` returned a PNG data URL of length 168,918.
- The transient 126,672-byte PNG had SHA-256 `A8A3620E49C6F1D2FD627FAB7C5F362B53D9C1B97627975417745C5B084A58A9`, was visually checked for a green multiscale blade field, and was removed. No generated binary remains.

Repository suite:

```text
npm test
tests 473; pass 470; fail 3
```

The same three inherited integration failures remain outside owned paths:

- generated HTML component catalog is stale;
- symbolic document scope expected `8`, observed `-8`;
- named symbolic function/constant geometry expected `[-5, 625]`, observed `[-5, -624]`.

## Content hashes

| Path | Git blob | SHA-256 |
| --- | --- | --- |
| `web/vf-ui/vf-grass-material-field.mjs` | `6c1fb6f14f7057d8350333e0b71700179e15d5e1` | `417265C8EEF093B0A7D5AB06B2D88CBDCDCB7B8AD83BF6B037D9115D2745A21A` |
| `tests/js/vf-grass-material-field.test.mjs` | `cb344fc212c37a6bc69e3f039f53b93023202ac6` | `92994A71CCCEA4CF16784622E00AE72F1298D420ED2550A3D51729AF03F798C0` |
| `tests/fixtures/grass-material-field-smoke.html` | `350a8979d8ac4d739aaf253360ae0bcb92372785` | `C3CAD87DD22B0407A04EE6ABFD914B7993B922DEAC33326A3AB4CB11D4AEA889` |

## Remaining boundary

This packet expands each demanded blade into a compact typed quad. A later internal packet can replace those quads with a dedicated instanced blade pipeline and move filtered grass channels into WGSL, while preserving the same conditioned cell/blade identities and public silence. Camera-to-cell demand scheduling also remains a separate consumer of the bounded cell interface.

Recovery: drop commits after base `89f8b36`; no other worktree is required.
