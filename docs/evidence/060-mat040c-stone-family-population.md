# MAT040C conditioned stone-family patch population evidence

Date: 2026-09-01

## Packet

- Base: `3af5ae3` (MAT040B).
- Branch: `codex/0.6/060-mat040c-stone-family-population`.
- Scope: internal demand-driven family and patch population realization over the existing conditioned distribution, marked-point, and multiscale rock material contracts.
- Public VKF syntax/API/schema changes: none.
- Renderer changes: none.
- Owned paths:
  - `web/vf-ui/vf-stone-family-population.mjs`
  - `tests/js/vf-stone-family-population.test.mjs`
  - `docs/evidence/060-mat040c-stone-family-population.md`

## Observable internal contract

- A population remains an immutable conditioned identity until patches are demanded. A zero stone budget realizes no patch, family, point population, or typed vector.
- Demand is canonicalized, deduplicated, and sorted by integer patch coordinates. Distant patches are direct keyed demands and do not traverse intervening space.
- Every realized patch uses at most 16 candidate slots. A request is capped at 4,096 patches and 65,536 stones.
- Each population keeps at most 8,192 patch realizations in least-recently-used order. Population state is weakly owned and becomes collectable with the population.
- Output is vector-first: positions and radii are packed `Float32Array` triples; rotations are packed `Float32Array`; family indices are packed `Uint32Array`. IDs are the stable marked-point identities.
- Four conditioned stone families own stable base radii and one existing multiscale rock material field each. Families are created only when selected by a demanded stone.
- Each patch selects a deterministic dominant family. Every individual follows that family with 82% conditioned probability or selects another family; scale and asymmetry then vary independently within the family. The pinned patch produced 10 dominant-family stones among 13 candidates.
- Repeated demand reuses the exact immutable patch object. Recreated populations produce equal vectors and family material samples without shared mutable traversal state.

## RED to GREEN

1. `74a352a` pinned lazy vector-first family population behavior and failed because no stone population module existed.
2. `d058922` added the bounded conditioned patch/family realization path using the existing marked-point and rock-field contracts.
3. `1e1edb5` pinned exact population records, family affinity, order/recreation independence, distant zero-work behavior, and hard caps.

## Executable evidence

Focused affected chain:

```text
node --test tests/js/vf-stone-family-population.test.mjs tests/js/vf-marked-point-candidates.test.mjs tests/js/vf-conditioned-distribution.test.mjs tests/js/vf-spatial-correlation.test.mjs tests/js/vf-rock-material-field.test.mjs tests/js/vf-rock-material-realization-cache.test.mjs tests/js/vf-rock-material-packet-cache.test.mjs
tests 42; pass 42; fail 0
```

Pinned patch `stone:patch:2:-1`:

```text
stones 13; vector bytes 416; dominant family 3
family indices [3,3,3,1,3,2,3,3,2,3,3,3,3]
used material families [stone:family:1, stone:family:2, stone:family:3]
```

The first two packed positions, including radius-derived surface height, are:

```text
[11.204845428466797, -3.855315685272217, 0.4602487087249756,
  8.276394844055176, -3.616556406021118, 0.3930971324443817]
```

Real CPU/GPU rock-field parity through Edge `--headless=new`:

```text
outcome pass; records 3; maxAbsoluteError 0.00024956464767456055; maxOctaves 6
streamWords [3982524626, 2941269488, 3065520907, 1471304979]
```

Hidden non-renderer regression capture:

- 58,298-byte PNG.
- SHA-256 `20C7B5A2E8B1BA73F2CA56AEB5B22159F3D5F1AA8D07B3AAA5066A5DEC8F0B7A`.
- Exact parity with MAT030B through MAT040B.
- WebGPU initialized at 1,236 x 725 with no initialization or runtime failure; retained rock material buffers remained 144, 96, and 96 bytes.

Interleaved hot/cold Node timing used eight demanded patches, a 64-stone budget, 256 realizations per pass, and seven alternating passes. The hot population reused bounded patch/family state; the cold reference recreated the identical conditioned population each iteration:

```text
cold ms: [1182.5290, 1221.3676, 1250.5198, 1415.9449, 1367.8868, 1581.1621, 1612.7270]
hot ms:  [6.9769, 3.9642, 5.3460, 3.4353, 6.3472, 7.9332, 7.2714]
median: cold 1367.8868 ms; hot 6.3472 ms
speedup: 215.5103x
checksum: 17265.303016662598; exact equality on every pass
```

Repository suite:

```text
npm test
tests 511; pass 508; fail 3
```

The same inherited failures remain outside this packet's owned paths:

- generated HTML component catalog is stale;
- symbolic document scope expected `8`, observed `-8`;
- named symbolic function/constant geometry expected `[-5, 625]`, observed `[-5, -624]`.

## Content hashes

| Path | Git blob | SHA-256 |
| --- | --- | --- |
| `web/vf-ui/vf-stone-family-population.mjs` | `b4af8bcb8b87ad98b7c57cfd4148c8b5a928ebc9` | `8ECFABED31DAADF346CC38180F2CD603302B7EACF148FDD6FE57AED335C60928` |
| `tests/js/vf-stone-family-population.test.mjs` | `09ee170ab3cee0ef090add62b1abe0ce535da757` | `017949F0B5E85F7311F5E06CA80EB3E7009255100D37F699161F01BF7426F00B` |

## Remaining boundary

This is a non-renderer population packet. It deliberately does not expand family vectors into geometry packets or introduce a public `stone`, `rock`, or material-construction API. A later internal adapter can consume these vectors and existing retained ellipsoid/material packets without changing the deterministic family or patch identities established here.

Recovery: drop commits after base `3af5ae3`; no 0.4 or shared renderer path was touched.
