# MAT050C bounded tree view-demand evidence

Date: 2026-09-01

## Packet

- Base: `3c27b9f` (MAT050B).
- Branch: `codex/0.6/060-mat050c-tree-view-demand`.
- Scope: internal camera/frustum-to-tree detail selection over MAT050A forest vectors and MAT050B geometry planning.
- Public VKF syntax/API/schema/ABI changes: none.
- Renderer changes: none.
- Owned paths:
  - `web/vf-ui/vf-tree-view-demand.mjs`
  - `tests/js/vf-tree-view-demand.test.mjs`
  - `docs/evidence/060-mat050c-tree-view-demand.md`

## Observable internal contract

- Each realized tree is conservatively bounded from its packed position, height, and crown radius, then culled against the camera frustum and finite far distance.
- Visible trees rank deterministically by projected screen size, camera depth, then stable forest index. The output is canonical packed `Uint32Array` tree indices plus parallel `Uint8Array` detail levels.
- Internal projected-size thresholds select trunk/crown-only detail, branches, or foliage clusters. These thresholds are not a public policy or API.
- A primitive budget first reserves the two coarse primitives for every selected tree. It then distributes four-branch upgrades before sixteen-foliage upgrades, so one detailed tree cannot starve another tree's silhouette.
- Demand is capped at 4,096 selected trees and 65,536 planned primitives. A zero or sub-coarse primitive budget scans and realizes no tree demand.
- The emitted demand is consumed directly by MAT050B and exactly predicts its primitive count. Five packed demand bytes select each tree (`u32` index plus `u8` detail).
- Recreated camera records produce equal demand vectors. Camera distance refines shared tree identities without changing them.

## RED to GREEN

1. `91ad589` pinned bounded camera demand and failed because no tree view-demand module existed.
2. `36b6e2c` implemented conservative frustum selection, deterministic screen-error ranking, and coarse-first primitive allocation.
3. `846fc46` pinned exact tree/detail vectors and removed quadratic truncation accounting.

## Executable evidence

Focused affected chain:

```text
node --test tests/js/vf-tree-view-demand.test.mjs tests/js/vf-tree-geometry-plan.test.mjs tests/js/vf-forest-population.test.mjs tests/js/vf-marked-point-candidates.test.mjs tests/js/vf-conditioned-distribution.test.mjs tests/js/vf-spatial-correlation.test.mjs
tests 37; pass 37; fail 0
```

Pinned 126-tree forest, 24-tree / 256-primitive camera demand:

```text
tree indices [1, 3, 18, 19, 62, 64, 66, 69, 74, 75, 77, 80,
              81, 82, 83, 84, 85, 87, 88, 89, 90, 91, 93, 124]
detail levels [1, 1, 1, 1, 2, 1, 2, 1, 1, 1, 2, 2,
               1, 1, 2, 1, 2, 1, 1, 2, 1, 1, 1, 1]
planned primitives 256; demand vector bytes 120
visible 126; selected 24; truncated true
```

Pinned eight-tree / 24-primitive pressure case:

```text
tree indices [62, 66, 69, 77, 80, 83, 85, 89]
detail levels [0, 0, 0, 1, 0, 0, 1, 0]
planned primitives 24; every tree retains trunk and crown
```

Real CPU/GPU rock-field parity through Edge `--headless=new`:

```text
outcome pass; records 3; maxAbsoluteError 0.00024956464767456055; maxOctaves 6
streamWords [3982524626, 2941269488, 3065520907, 1471304979]
```

Hidden non-renderer regression capture:

- 58,298-byte PNG.
- SHA-256 `20C7B5A2E8B1BA73F2CA56AEB5B22159F3D5F1AA8D07B3AAA5066A5DEC8F0B7A`.
- Exact parity with MAT030B through MAT050B.
- WebGPU initialized at 1,236 x 725 without initialization/runtime failures; retained rock buffers remained 144, 96, and 96 bytes.

Node timing compared cold eager level-two planning for all 126 forest trees with cold view selection plus bounded planning. It used 64 operations per pass and seven passes; every path reproduced its exact checksum:

```text
eager: 2,772 primitives; 116,424 vector bytes
selected: 24 trees; 256 primitives; 10,752 geometry bytes + 120 demand bytes
primitive reduction 10.8281x; geometry memory reduction 10.8281x
eager median 1744.1466 ms; selected median 190.8341 ms
complete demand-plus-plan speedup 9.1396x
```

Repository suite:

```text
npm test
tests 521; pass 518; fail 3
```

The same inherited failures remain outside this packet's owned paths:

- generated HTML component catalog is stale;
- symbolic document scope expected `8`, observed `-8`;
- named symbolic function/constant geometry expected `[-5, 625]`, observed `[-5, -624]`.

## Content hashes

| Path | Git blob | SHA-256 |
| --- | --- | --- |
| `web/vf-ui/vf-tree-view-demand.mjs` | `5317bddc0ae304ea4dc5649ecfbad4875c93cf61` | `86878F8D2BA55829D59F3B9D3028F98B828788651FAAAD9614871728F4183A3D` |
| `tests/js/vf-tree-view-demand.test.mjs` | `23a96423041aaa8df067d2072c08232a4708a246` | `B3936619F9BCD1B035E793E4BC2AC28067DD514F10B7344DB1D46C39C41D5C3F` |

## Remaining boundary

This packet selects internal geometry demand only. Renderer mesh realization, temporal LOD hysteresis, bark and leaf material packets, botanical species names, and a public tree/forest API remain deliberately uncommitted. The next isolated material slice can attach deterministic bark/foliage descriptors to these stable tree and primitive identities without changing camera selection or packed geometry.

Recovery: drop commits after base `3c27b9f`; no 0.4 or shared renderer path was touched.
